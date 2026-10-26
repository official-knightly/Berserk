module.exports = {
  apps: [{
    name: "berserk-api",
    script: "dist/server.js",
    cwd: __dirname,
    instances: 1,
    exec_mode: "fork",
    autorestart: true,
    watch: false,
    max_restarts: 20,
    restart_delay: 1000,
    env: { NODE_ENV: "production", PORT: "3000" }
  }]
};
