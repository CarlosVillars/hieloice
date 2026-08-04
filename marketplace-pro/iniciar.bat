@echo off
cd /d "%~dp0"
set SUPABASE_URL=https://ltqbezanlnkmafflsxfg.supabase.co
set SUPABASE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx0cWJlemFubG5rbWFmZmxzeGZnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU2OTE1MzksImV4cCI6MjEwMTI2NzUzOX0.nXYTnmQMCyTLnPlE1mCOOx0yN_vCwA80Tq72feSnzIA
echo Starting Marketplace Pro server (connected to live database)...
start "Marketplace Pro - do not close this window" cmd /k node server.js
timeout /t 2 /nobreak >nul
start "" http://localhost:3000
