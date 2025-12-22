module.exports = {
  apps: [
    {
      name: "server",
      script: "dist/server.js",
      instances: 1,
      exec_mode: "fork",
      watch: false,
      ignore_watch: ["node_modules", "dist/**/*.map", ".git", "logs"],
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
