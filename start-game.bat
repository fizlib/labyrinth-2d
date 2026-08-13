@echo off
setlocal

set "ROOT=%~dp0"
cd /d "%ROOT%"

echo False Arrow launcher
echo.

if not exist "%ROOT%node_modules\" (
  echo node_modules not found. Installing dependencies...
  npm install
  if errorlevel 1 (
    echo.
    echo npm install failed. Please check the error above.
    pause
    exit /b 1
  )
  echo.
)

echo Starting False Arrow server and client...
start "False Arrow Server" /D "%ROOT%" cmd /k "npm run dev -w packages/server"
start "False Arrow Client" /D "%ROOT%" cmd /k "npm run dev -w packages/client"

echo Waiting for the client dev server to start...
timeout /t 5 /nobreak >nul

start "" "http://localhost:5173"

echo.
echo Game is starting in your browser at http://localhost:5173
echo Close the Server and Client terminal windows to stop the game.
echo.
pause
