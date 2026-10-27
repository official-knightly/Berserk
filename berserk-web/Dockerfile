# Build the existing Rust engine without changing its source or Cargo.toml.
FROM rust:nightly AS engine-build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends build-essential clang libclang-dev pkg-config && rm -rf /var/lib/apt/lists/*
COPY . .
RUN sed -i 's/^edition = "2026"$/edition = "2024"/' Cargo.toml && cargo build --release --bin berserk

FROM node:22-bookworm-slim AS node-build
WORKDIR /app
COPY berserk-web/package*.json ./
RUN npm install
COPY berserk-web/ ./
RUN npm run build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends libstdc++6 libgcc-s1 && rm -rf /var/lib/apt/lists/*
COPY --from=node-build /app/package.json ./package.json
COPY --from=node-build /app/node_modules ./node_modules
COPY --from=node-build /app/dist ./dist
COPY --from=engine-build /app/target/release/berserk ./berserk
ENV ENGINE_PATH=/app/berserk
ENV PORT=3000
EXPOSE 3000
CMD ["node", "dist/server.js"]
