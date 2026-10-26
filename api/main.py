import asyncio
import os
import re
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, field_validator

ENGINE_BIN = os.getenv("BERSERK_ENGINE_PATH", "/usr/local/bin/berserk")
MAX_CONCURRENT_SEARCHES = max(1, min(4, int(os.getenv("MAX_CONCURRENT_SEARCHES", "2"))))
SEARCH_SLOTS = asyncio.Semaphore(MAX_CONCURRENT_SEARCHES)

app = FastAPI(
    title="Berserk Chess Engine API",
    version="1.0.0",
    description="HTTP wrapper for the native Berserk UCI chess engine.",
)

allowed_origins = [
    origin.strip()
    for origin in os.getenv("ALLOWED_ORIGINS", "*").split(",")
    if origin.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

PIECES = set("pnbrqkPNBRQK")


class AnalyzeRequest(BaseModel):
    fen: str = Field(
        min_length=20,
        max_length=128,
        description="Standard six-field FEN for the position to analyse.",
    )
    think_time_ms: int = Field(default=1000, ge=100, le=10000)
    multi_pv: int = Field(default=1, ge=1, le=8)
    threads: int = Field(default=1, ge=1, le=2)
    context: int | None = None

    @field_validator("fen")
    @classmethod
    def validate_fen(cls, value: str) -> str:
        if any(char in value for char in "\r\n\t\0"):
            raise ValueError("FEN must be a single line.")
        value = " ".join(value.strip().split())
        fields = value.split(" ")
        if len(fields) != 6:
            raise ValueError("FEN must contain all six standard fields.")

        ranks = fields[0].split("/")
        if len(ranks) != 8:
            raise ValueError("FEN board must contain eight ranks.")
        for rank in ranks:
            squares = 0
            for char in rank:
                if char in "12345678":
                    squares += int(char)
                elif char in PIECES:
                    squares += 1
                else:
                    raise ValueError("FEN contains an invalid piece placement.")
            if squares != 8:
                raise ValueError("Every FEN rank must describe exactly eight squares.")

        if fields[1] not in ("w", "b"):
            raise ValueError("FEN active colour must be 'w' or 'b'.")
        if not re.fullmatch(r"-|K?Q?k?q?", fields[2]):
            raise ValueError("FEN castling rights are invalid.")
        if not re.fullmatch(r"-|[a-h][36]", fields[3]):
            raise ValueError("FEN en-passant square is invalid.")
        if not fields[4].isdigit() or not fields[5].isdigit() or int(fields[5]) < 1:
            raise ValueError("FEN move counters are invalid.")
        if fields[0].count("K") != 1 or fields[0].count("k") != 1:
            raise ValueError("FEN must contain one king of each colour.")
        return value


def parse_info(line: str, candidates: dict[int, dict[str, Any]]) -> None:
    depth_match = re.search(r"\bdepth\s+(\d+)", line)
    score_match = re.search(r"\bscore\s+(cp|mate)\s+(-?\d+)", line)
    pv_match = re.search(r"\bpv\s+(.+)$", line)
    if not depth_match or not score_match or not pv_match:
        return

    depth = int(depth_match.group(1))
    rank_match = re.search(r"\bmultipv\s+(\d+)", line)
    rank = int(rank_match.group(1)) if rank_match else 1
    score_type = score_match.group(1)
    raw_score = int(score_match.group(2))
    pv = pv_match.group(1).strip().split()
    if not pv or not re.fullmatch(r"[a-h][1-8][a-h][1-8][qrbn]?", pv[0]):
        return

    previous = candidates.get(rank)
    if previous is not None and depth < previous["depth"]:
        return

    score_cp = raw_score if score_type == "cp" else (30000 if raw_score > 0 else -30000)
    nodes_match = re.search(r"\bnodes\s+(\d+)", line)
    candidates[rank] = {
        "rank": rank,
        "depth": depth,
        "uci": pv[0],
        "pv": pv,
        "scoreCp": score_cp,
        "mate": raw_score if score_type == "mate" else None,
        "nodes": int(nodes_match.group(1)) if nodes_match else None,
    }


async def read_until(proc: asyncio.subprocess.Process, expected: str, timeout: float) -> None:
    deadline = asyncio.get_running_loop().time() + timeout
    while True:
        remaining = deadline - asyncio.get_running_loop().time()
        if remaining <= 0:
            raise asyncio.TimeoutError
        line_bytes = await asyncio.wait_for(proc.stdout.readline(), timeout=remaining)
        if not line_bytes:
            raise RuntimeError(f"Berserk exited before replying with {expected}.")
        if line_bytes.decode("utf-8", errors="replace").strip() == expected:
            return


async def run_search(request: AnalyzeRequest) -> dict[str, Any]:
    try:
        proc = await asyncio.create_subprocess_exec(
            ENGINE_BIN,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
        )
    except FileNotFoundError as exc:
        raise RuntimeError("Berserk executable is missing from the API container.") from exc

    candidates: dict[int, dict[str, Any]] = {}
    bestmove: str | None = None
    last_depth = 0
    last_nodes: str | None = None

    async def send(command: str) -> None:
        if proc.stdin is None:
            raise RuntimeError("Engine stdin is unavailable.")
        proc.stdin.write((command + "\n").encode("utf-8"))
        await proc.stdin.drain()

    try:
        await send("uci")
        await read_until(proc, "uciok", timeout=12)
        await send("isready")
        await read_until(proc, "readyok", timeout=12)
        await send(f"setoption name Threads value {request.threads}")
        await send(f"setoption name MultiPV value {request.multi_pv}")
        await send(f"position fen {request.fen}")
        await send(f"go movetime {request.think_time_ms}")

        deadline = asyncio.get_running_loop().time() + request.think_time_ms / 1000 + 8
        while True:
            remaining = deadline - asyncio.get_running_loop().time()
            if remaining <= 0:
                raise asyncio.TimeoutError
            line_bytes = await asyncio.wait_for(proc.stdout.readline(), timeout=remaining)
            if not line_bytes:
                raise RuntimeError("Berserk closed its output before returning a best move.")
            line = line_bytes.decode("utf-8", errors="replace").strip()

            if line.startswith("info "):
                parse_info(line, candidates)
                depth_match = re.search(r"\bdepth\s+(\d+)", line)
                nodes_match = re.search(r"\bnodes\s+(\d+)", line)
                if depth_match:
                    last_depth = max(last_depth, int(depth_match.group(1)))
                if nodes_match:
                    last_nodes = nodes_match.group(1)
            elif line.startswith("bestmove "):
                bestmove = line.split()[1]
                break

        ordered = sorted(candidates.values(), key=lambda candidate: candidate["rank"])
        top = next((candidate for candidate in ordered if candidate["rank"] == 1), None)
        if bestmove is None:
            raise RuntimeError("Berserk did not return a best move.")

        return {
            "ok": True,
            "engine": "Berserk",
            "bestmove": bestmove,
            "scoreCp": top["scoreCp"] if top else None,
            "depth": top["depth"] if top else last_depth,
            "nodes": last_nodes or (str(top["nodes"]) if top and top["nodes"] is not None else None),
            "candidates": [
                {
                    "rank": candidate["rank"],
                    "depth": candidate["depth"],
                    "uci": candidate["uci"],
                    "pv": candidate["pv"],
                    "scoreCp": candidate["scoreCp"],
                    "mate": candidate["mate"],
                }
                for candidate in ordered
            ],
            "context": request.context,
        }
    finally:
        if proc.returncode is None:
            try:
                if proc.stdin is not None and not proc.stdin.is_closing():
                    proc.stdin.write(b"quit\n")
                    await proc.stdin.drain()
                    proc.stdin.close()
            except (BrokenPipeError, ConnectionResetError):
                pass
            try:
                await asyncio.wait_for(proc.wait(), timeout=2)
            except asyncio.TimeoutError:
                proc.kill()
                await proc.wait()


@app.get("/")
@app.get("/api/v1")
async def root() -> dict[str, Any]:
    return {
        "name": "Berserk Chess Engine API",
        "status": "online",
        "base_url": "https://berserk/api/v1",
        "health": "/api/v1/health",
        "analyze": {"method": "POST", "path": "/api/v1/analyze"},
        "docs": "/docs",
    }


@app.get("/health")
@app.get("/api/v1/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "engine": "Berserk"}


@app.get("/client.js")
async def browser_client() -> FileResponse:
    client_path = os.path.join(os.path.dirname(__file__), "client.js")
    if not os.path.isfile(client_path):
        raise HTTPException(status_code=404, detail="Browser client script is unavailable.")
    return FileResponse(
        client_path,
        media_type="application/javascript",
        headers={"Cache-Control": "no-cache"},
    )


@app.post("/api/analyze")
@app.post("/api/v1/analyze")
async def analyze(request: AnalyzeRequest) -> dict[str, Any]:
    try:
        await asyncio.wait_for(SEARCH_SLOTS.acquire(), timeout=2)
    except asyncio.TimeoutError as exc:
        raise HTTPException(
            status_code=503,
            detail="The engine is busy. Retry the request shortly.",
        ) from exc

    try:
        try:
            return await run_search(request)
        except asyncio.TimeoutError as exc:
            raise HTTPException(
                status_code=504,
                detail="Engine search timed out before a move was returned.",
            ) from exc
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(
                status_code=502,
                detail=f"Berserk engine request failed: {exc}",
            ) from exc
    finally:
        SEARCH_SLOTS.release()
