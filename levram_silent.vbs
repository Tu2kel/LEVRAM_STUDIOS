' ─────────────────────────────────────────────────────────────────
'  LEVRAM STUDIOS — Silent WSL Launcher
'  Runs start_levram.sh inside WSL with NO terminal window visible.
'  Called by Task Scheduler at Windows login.
' ─────────────────────────────────────────────────────────────────
Set WShell = CreateObject("WScript.Shell")

' Build the WSL command
Dim cmd
cmd = "wsl.exe bash -c ""cd ~/thok_Apps/LEVRAM_STUDIOS && bash start_levram.sh"""

' Run hidden (0 = hidden window, False = don't wait for exit)
WShell.Run cmd, 0, False

Set WShell = Nothing
