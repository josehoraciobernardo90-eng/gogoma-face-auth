import subprocess
import time
import os
import sys

def start_service(name, command, cwd):
    print(f"[SENTINEL] Iniciando {name}...")
    try:
        # Abre o processo e redireciona a saída para um arquivo específico
        log_file = open(f"sentinel_{name.lower().replace(' ', '_')}.log", "w")
        process = subprocess.Popen(
            command,
            cwd=cwd,
            shell=True,
            stdout=log_file,
            stderr=log_file,
            text=True
        )
        return process, log_file
    except Exception as e:
        print(f"[ERRO] Falha ao iniciar {name}: {e}")
        return None, None

def main():
    root_dir = os.getcwd()
    
    # 1. Limpar processos antigos na porta 3001 (Força Bruta Profissional)
    if sys.platform == "win32":
        os.system("for /f \"tokens=5\" %a in ('netstat -aon ^| findstr :3001') do taskkill /f /pid %a >nul 2>&1")

    # 2. Iniciar Backend
    server_proc, server_log = start_service(
        "Backend Server",
        "node server.js",
        os.path.join(root_dir, "server")
    )

    # 3. Iniciar Frontend (Vite)
    client_proc, client_log = start_service(
        "Dashboard UI",
        "npm run dev",
        os.path.join(root_dir, "client")
    )

    # 4. Iniciar IA Sentinel
    ai_proc, ai_log = start_service(
        "AI Engine",
        "python sentinel_edge.py",
        root_dir
    )

    print("\n" + "="*50)
    print("   SISTEMA GOGOMA SENTINEL V3 ESTA SENDO MONITORADO")
    print("="*50)
    print("Aguardando 10 segundos para estabilizacao...")
    time.sleep(10)
    
    print(f"\n[INFO] Dashboard disponivel em: http://localhost:7777")
    print("[INFO] Pressione CTRL+C para encerrar todos os servicos.")

    try:
        while True:
            # Verifica se os processos ainda estao vivos
            if server_proc.poll() is not None:
                print("[ALERTA] O Servidor Backend parou inesperadamente!")
            if client_proc.poll() is not None:
                print("[ALERTA] O Dashboard UI parou inesperadamente!")
            time.sleep(5)
    except KeyboardInterrupt:
        print("\n[SENTINEL] Encerrando todos os servicos de seguranca...")
        server_proc.terminate()
        client_proc.terminate()
        ai_proc.terminate()
        server_log.close()
        client_log.close()
        ai_log.close()
        print("[SENTINEL] Sistema desligado com sucesso.")

if __name__ == "__main__":
    main()
