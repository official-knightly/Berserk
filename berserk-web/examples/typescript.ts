const API_URL = "https://YOUR-API-DOMAIN.example.com";

type BestMoveResponse = { bestmove: string; info: string };
type ApiError = { error?: string };

export async function getBestMove(
  fen: string,
  movetime = 1000
): Promise<BestMoveResponse> {
  const response = await fetch(`${API_URL}/bestmove`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fen, movetime })
  });
  const data = (await response.json()) as BestMoveResponse | ApiError;
  if (!response.ok) {
    throw new Error("error" in data ? data.error ?? response.statusText : response.statusText);
  }
  return data as BestMoveResponse;
}

// Example:
// const result = await getBestMove("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", 1000);
// console.log(result.bestmove, result.info);
