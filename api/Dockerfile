FROM rustlang/rust:nightly
WORKDIR /app
COPY . .
# The repository currently declares edition 2026; adjust only the container build copy.
RUN sed -i 's/^edition = "2026"$/edition = "2024"/' Cargo.toml \
 && cargo build --release --bin berserk
FROM node:22-bookworm-slim
WORKDIR /app
COPY --from=0 /app/target/release/berserk /app/berserk
COPY api/server.mjs /app/server.mjs
ENV PORT=8787
ENV ENGINE_PATH=/app/berserk
EXPOSE 8787
CMD ["node", "server.mjs"]
