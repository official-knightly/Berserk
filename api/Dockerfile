# Build from the repository root:
# docker build -f api/Dockerfile -t berserk-api .
FROM rust:slim-bookworm AS engine-build

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       build-essential ca-certificates clang curl libclang-dev pkg-config \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /engine
COPY . .

# The repository manifest currently says edition 2026, which stable Cargo
# toolchains may not recognize. Normalize only this temporary image copy.
# The tracked Cargo.toml and all engine source files stay untouched.
RUN sed -i 's/^edition = "2026"$/edition = "2024"/' Cargo.toml \
    && cargo build --release --no-default-features

FROM python:3.12-slim-bookworm AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=10000 \
    BERSERK_ENGINE_PATH=/usr/local/bin/berserk

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY api/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY api/main.py ./main.py
COPY api/client.js ./client.js
COPY --from=engine-build /engine/target/release/berserk /usr/local/bin/berserk
RUN chmod 755 /usr/local/bin/berserk

EXPOSE 10000
CMD ["sh", "-c", "exec uvicorn main:app --host 0.0.0.0 --port \"$PORT\""]
