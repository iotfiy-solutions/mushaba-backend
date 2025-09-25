module.exports = {
  apps: [{
    name: 'mushaba-server',
    script: './server.js',
    cwd: __dirname, // Use current directory instead of placeholder
    instances: 1, // or 'max' for cluster mode
    exec_mode: 'fork', // or 'cluster'
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'development',
      PORT: 3000,
      // Leave LID_PYTHON unset - let lid.js auto-detect the venv
      // It will find .venv/Scripts/python.exe on Windows or .venv/bin/python on Linux
      LID_MODEL: 'small',
      LID_CONFIDENCE_MIN: '0.75',
      LID_NO_SPEECH_THRESHOLD: '0.5',
      LID_COMPUTE_TYPE: 'int8'
      // GOOGLE_APPLICATION_CREDENTIALS should be set via your .env file or system env
    },
    env_production: {
      NODE_ENV: 'production',
      PORT: 8080,
      // For Linux production
      LID_PYTHON: '/opt/lid-venv/bin/python',
      LID_MODEL: 'small',
      LID_CONFIDENCE_MIN: '0.75',
      LID_NO_SPEECH_THRESHOLD: '0.5',
      LID_COMPUTE_TYPE: 'int8'
      // GOOGLE_APPLICATION_CREDENTIALS should be set via system env for security
    },
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    log_file: './logs/combined.log',
    time: true,
    // Additional production settings
    autorestart: true,
    max_restarts: 10,
    min_uptime: '10s'
  }]
};
