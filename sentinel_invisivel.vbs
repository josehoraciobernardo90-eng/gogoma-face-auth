Set WshShell = CreateObject("WScript.Shell")
' Executa o arquivo .bat de forma invisível (0)
WshShell.Run chr(34) & "C:\Users\DELL\.gemini\antigravity\scratch\gogoma-face-auth\run_sentinel.bat" & Chr(34), 0
Set WshShell = Nothing
