#!/bin/bash

# Configuration
PORT=3000
START_COMMAND="npm run dev"

echo "======================================"
echo "      Restarting Next.js App          "
echo "======================================"

# Find PID of process listening on port 3000
# Using netstat for Windows compatibility in Git Bash
PID=$(netstat -ano | grep :$PORT | grep LISTENING | awk '{print $5}' | head -n 1)

if [ -n "$PID" ]; then
    echo "Found process $PID running on port $PORT. Killing it..."
    # //F and //PID for compatibility with Git Bash on Windows
    taskkill.exe //F //PID $PID
    if [ $? -eq 0 ]; then
        echo "Successfully killed process on port $PORT."
    else
        echo "Failed to kill process on port $PORT."
    fi
else
    echo "No process found running on port $PORT."
fi

echo "Starting app with: $START_COMMAND"
$START_COMMAND
