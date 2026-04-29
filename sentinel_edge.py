import cv2
import time
import datetime
import os
import json
import threading
import requests

# --- CONFIGURAÇÕES DINÂMICAS ---
SERVER_API_URL = "http://127.0.0.1:3001/api/config"

class VideoStream:
    def __init__(self, src):
        self.stream = cv2.VideoCapture(src)
        self.stream.set(cv2.CAP_PROP_BUFFERSIZE, 1) # Reduz latência (Lag) drasticamente
        (self.grabbed, self.frame) = self.stream.read()
        self.stopped = False

    def start(self):
        threading.Thread(target=self.get, args=()).start()
        return self

    def get(self):
        while not self.stopped:
            if not self.grabbed:
                self.stop()
            else:
                (self.grabbed, self.frame) = self.stream.read()

    def stop(self):
        self.stopped = True
        self.stream.release()

def get_camera_source():
    print("[WAIT] Aguardando configuração de IP no Painel Gogoma...")
    while True:
        try:
            response = requests.get(SERVER_API_URL, timeout=3)
            if response.status_code == 200:
                ip_raw = response.json().get("cameraIp", "0").strip()
                if ip_raw != "0" and ip_raw != "": 
                    url = ip_raw if ip_raw.startswith("http") else f"http://{ip_raw}:8080/video"
                    print(f"[OK] Câmera Detectada: {url}")
                    return url
        except Exception as e: 
            print(f"[REDE] Erro ao conectar no servidor: {e}")
        time.sleep(5)

CAMERA_SOURCE = get_camera_source()
OUTPUT_DIR = "sentinel_records"
if not os.path.exists(OUTPUT_DIR): os.makedirs(OUTPUT_DIR)

# Configurações de sensibilidade (Otimizado para Longa Distância)
MIN_MOTION_AREA = 40 # Reduzido para capturar pessoas bem distantes
STOP_DELAY = 10 

def trigger_panic():
    try: requests.post(SERVER_API_URL, json={"isPanic": True}, timeout=3)
    except: pass

def run_sentinel():
    print(f"[INFO] Iniciando Motor de Fluxo Estabilizado em: {CAMERA_SOURCE}")
    vs = VideoStream(CAMERA_SOURCE).start()
    time.sleep(2.0) # Buffer inicial

    face_cascade = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_frontalface_default.xml')
    # Inicializa o Detector de Pessoas (HOG) - Tecnologia Robusta para Corpos
    hog = cv2.HOGDescriptor()
    hog.setSVMDetector(cv2.HOGDescriptor_getDefaultPeopleDetector())
    
    # varThreshold reduzido de 50 para 25 para maior sensibilidade a mudanças sutis
    back_sub = cv2.createBackgroundSubtractorMOG2(history=500, varThreshold=25, detectShadows=True)
    
    is_recording = False
    video_writer = None
    last_motion_time = 0
    is_armed = False
    is_panic = False

    # Thread de sincronização de estado
    def sync_config():
        nonlocal is_armed, is_panic
        while True:
            try:
                res = requests.get(SERVER_API_URL, timeout=1)
                if res.status_code == 200:
                    data = res.json()
                    is_armed = data.get("isArmed", False)
                    is_panic = data.get("isPanic", False)
            except: pass
            time.sleep(2)
    
    threading.Thread(target=sync_config, daemon=True).start()

    print("[SYSTEM] Sentinel Vigilante ONLINE.")

    while True:
        if vs.stopped: break
        
        frame = vs.frame
        if frame is None: continue

        current_time = time.time()
        small_frame = cv2.resize(frame, (640, 480))
        fg_mask = back_sub.apply(small_frame)
        _, fg_mask = cv2.threshold(fg_mask, 254, 255, cv2.THRESH_BINARY)
        
        contours, _ = cv2.findContours(fg_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        
        motion_detected = False
        total_area = 0
        potential_human_shape = False
        
        for c in contours:
            area = cv2.contourArea(c)
            if area > MIN_MOTION_AREA:
                (x, y, w, h) = cv2.boundingRect(c)
                # Proporção Corporal: Humanos são geralmente mais altos que largos (Filtro Vertical)
                aspect_ratio = h / float(w) if w > 0 else 0
                if aspect_ratio > 1.2: potential_human_shape = True
                
                total_area += area
                motion_detected = True

        # Filtro de vibração/luz (40% da tela)
        if total_area > (640 * 480 * 0.4): motion_detected = False

        if motion_detected and is_armed and not is_panic:
            print(f"[VIGIA] Analisando movimento (Area: {total_area:.0f})...")
            
            # --- TRIPLA VALIDAÇÃO HUMANA ---
            is_human = False
            
            # 1. Detecção de Corpo (HOG)
            (rects, weights) = hog.detectMultiScale(small_frame, winStride=(8, 8), padding=(8, 8), scale=1.05)
            if len(rects) > 0: is_human = True
            
            # 2. Detecção de Rosto (Backup Rápido)
            if not is_human:
                gray = cv2.cvtColor(small_frame, cv2.COLOR_BGR2GRAY)
                faces = face_cascade.detectMultiScale(gray, 1.1, 3)
                if len(faces) > 0: is_human = True
            
            # 3. Detecção por Forma (Para alvos muito distantes/vultos)
            if not is_human and potential_human_shape and total_area > 150:
                is_human = True # Confirmação por silhueta vertical em movimento

            if is_human:
                print(f"[ALERT] !!! HUMANO CONFIRMADO !!! Area: {total_area} | Corpos: {len(rects)} | Rostos: {len(faces)}")
                # Envia pânico com protocolo de redundância
                def panic_task():
                    print("[GOGOMA] Iniciando sequência de disparo de alarme...")
                    for i in range(3):
                        try: 
                            r = requests.post(SERVER_API_URL, json={"isPanic": True}, timeout=2)
                            if r.status_code == 200: 
                                print(f"[OK] Alarme ativado na tentativa {i+1}")
                                break
                        except Exception as e: 
                            print(f"[ERRO] Falha no disparo (Tentativa {i+1}): {e}")
                            time.sleep(0.5)
                threading.Thread(target=panic_task).start()
                is_panic = True 
            else:
                # Log de movimento que não foi classificado como humano (útil para depuração)
                if total_area > 100: # Apenas se o movimento for relevante
                    print(f"[DEBUG] Movimento detectado (Area: {total_area:.0f}), mas sem silhueta humana clara.")

        # HUD visual
        status_text = "VIGILANCIA ATIVA" if is_armed else "DESARMADO"
        if is_panic: status_text = "!!! ALERTA DE PANICO !!!"
        color = (0, 0, 255) if is_armed else (0, 255, 0)
        cv2.putText(frame, f"GOGOMA SENTINEL | {status_text}", (20, 40), 
                    cv2.FONT_HERSHEY_SIMPLEX, 0.7, color, 2)

        if motion_detected:
            last_motion_time = current_time
            if not is_recording:
                timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
                filename = os.path.join(OUTPUT_DIR, f"alerta_{timestamp}.mp4")
                fourcc = cv2.VideoWriter_fourcc(*'mp4v')
                h, w, _ = frame.shape
                # Usando 8 FPS para máxima compatibilidade com redes instáveis
                video_writer = cv2.VideoWriter(filename, fourcc, 8.0, (w, h))
                is_recording = True
                print("[REC] Iniciando gravação de evidência...")

        if is_recording:
            video_writer.write(frame)
            if current_time - last_motion_time > STOP_DELAY:
                is_recording = False
                video_writer.release()
                print("[REC] Gravação finalizada.")

        # Limitar o loop para não sobrecarregar a CPU (8-10 FPS é ideal para análise)
        time.sleep(0.1)

    vs.stop()
    cv2.destroyAllWindows()

if __name__ == "__main__":
    run_sentinel()
