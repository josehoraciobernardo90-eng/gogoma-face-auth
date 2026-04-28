import socket
import os
import subprocess
import json

def check_port(port):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        return s.connect_ex(('127.0.0.1', port)) == 0

def get_node_version():
    try:
        return subprocess.check_output(['node', '-v'], stderr=subprocess.STDOUT).decode().strip()
    except:
        return "Not found"

def check_server_file():
    path = 'server/server.js'
    if os.path.exists(path):
        return f"Exists ({os.path.getsize(path)} bytes)"
    return "Missing"

report = {
    "port_3001_active": check_port(3001),
    "port_7777_active": check_port(7777),
    "node_version": get_node_version(),
    "server_file": check_server_file(),
    "current_dir": os.getcwd()
}

with open('sentinel_report.json', 'w') as f:
    json.dump(report, f, indent=4)

print("Relatório gerado com sucesso.")
