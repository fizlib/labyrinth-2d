@echo off
setlocal

set "ROOT=%~dp0"
cd /d "%ROOT%"

echo Labyrinth 2D launcher
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

echo Starting Labyrinth 2D server and client...
start "Labyrinth 2D Server" /D "%ROOT%" cmd /k "npm run dev -w packages/server"
start "Labyrinth 2D Client" /D "%ROOT%" cmd /k "npm run dev -w packages/client"

echo Waiting for the client dev server to start...
timeout /t 5 /nobreak >nul

start "" "http://localhost:5173"

echo.
echo Game is starting in your browser at http://localhost:5173
echo Close the Server and Client terminal windows to stop the game.
echo.
pause
