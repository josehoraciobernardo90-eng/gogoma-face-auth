import React, { useState, useRef, useEffect } from 'react';
import * as faceapi from 'face-api.js';
import { db, storage } from './firebase';
import { collection, addDoc, getDocs, query, orderBy, limit, serverTimestamp, deleteDoc, doc, setDoc, onSnapshot } from 'firebase/firestore';
import { ref, uploadString, getDownloadURL } from 'firebase/storage';
import { Camera, Users, History, CheckCircle, AlertCircle, Loader2, UserPlus, Shield, Search, Upload, RefreshCw, Trash2, Settings, Maximize, Minimize, ZoomIn, ZoomOut, Zap, Layout, Lock, Unlock } from 'lucide-react';

// --- COMPONENTE DE SEGURANÇA (ERROR BOUNDARY) ---
export class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { hasError: false, error: null }; }
  static getDerivedStateFromError(error) { return { hasError: true, error }; }
  componentDidCatch(error, errorInfo) { console.error("CRASH NO SENTINEL:", error, errorInfo); }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#0a0a0c] flex flex-col items-center justify-center text-white p-10 text-center">
          <AlertCircle size={80} className="text-red-500 mb-6 animate-pulse" />
          <h1 className="text-4xl font-black mb-4">SISTEMA COMPROMETIDO</h1>
          <p className="text-zinc-500 font-mono mb-8 max-w-lg">O núcleo do Sentinel encontrou um erro de execução. A integridade dos dados foi mantida, mas o motor visual falhou.</p>
          <pre className="bg-red-500/10 border border-red-500/30 p-4 rounded-xl text-left text-[10px] text-red-400 overflow-auto max-w-2xl mb-8">
            {this.state.error?.stack}
          </pre>
          <button onClick={() => window.location.reload()} className="bg-blue-600 px-8 py-3 rounded-2xl font-black hover:bg-blue-500 transition-all">REINICIAR NÚCLEO</button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function GogomaSentinelFirebase() {
  const [view, setView] = useState('monitor');
  const [isModelsLoaded, setIsModelsLoaded] = useState(false);
  const [status, setStatus] = useState('Standby');
  const [faceMatcher, setFaceMatcher] = useState(null);
  const [identifiedName, setIdentifiedName] = useState('Desconhecido');
  const [logs, setLogs] = useState([]);
  
  const [cameras, setCameras] = useState([{ id: 1, url: localStorage.getItem('gogoma_camera_url') || 'http://192.168.1.X:8080/video', zoom: 1 }]);
  const [zoom, setZoom] = useState(1);
  const [selectedImage, setSelectedImage] = useState(null); // Zoom Forense
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isArmed, setIsArmed] = useState(true);
  const [audioActive, setAudioActive] = useState(null); 
  const [isSuperAudio, setIsSuperAudio] = useState(false);
  const [nightModeCams, setNightModeCams] = useState(new Set()); // IDs das cams com visão noturna
  const audioCtxRef = useRef(null);
  const gainNodeRef = useRef(null);
  const MOTION_WIDTH = 64;
  const MOTION_HEIGHT = 48;
  const [debugStatus, setDebugStatus] = useState('Pronto'); 
  const [isPanic, setIsPanic] = useState(false); 
  const [cameraIp, setCameraIp] = useState(""); 
  const lastResidentRef = useRef(0); 


  const cameraRefs = useRef([]);
  const canvasRefs = useRef([]);
  const containerRef = useRef(null);
  const sirenRef = useRef(null); // Ref para parar a sirene
  const detectionBuffer = useRef({}); // { camId: [name1, name2, ...] }
  const detectionsByCamRef = useRef({}); // Deteções por câmera
  const motionCanvasRef = useRef(null); // Canvas persistente para evitar travamentos
  const prevFrameRef = useRef(null); 
  const audioSourceRef = useRef(null); // Ref para o áudio


  const isArmedRef = useRef(isArmed);
  const isPanicRef = useRef(isPanic);

  useEffect(() => { isArmedRef.current = isArmed; }, [isArmed]);
  useEffect(() => { isPanicRef.current = isPanic; }, [isPanic]);

  const saveCameras = (newCameras) => {
    setCameras(newCameras);
    if(newCameras.length > 0) localStorage.setItem('gogoma_camera_url', newCameras[0].url);
  };

  const updateCamZoom = (id, delta) => {
    setCameras(prev => prev.map(c => 
      c.id === id ? { ...c, zoom: Math.max(1, Math.min(c.zoom + delta, 5)) } : c
    ));
  };

  useEffect(() => {
    const handleFullscreenChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, []);

  const saveCameraIp = async (newIp) => {
    setCameraIp(newIp);
    
    try {
      // Usando Firebase Firestore (Nuvem) em vez de servidor local
      await setDoc(doc(db, 'system', 'config'), { cameraIp: newIp }, { merge: true });
      finalizeSave(newIp);
    } catch (e) { 
      console.error("Erro Crítico de Conexão Firebase:", e);
      alert("Erro de Rede: Não foi possível sincronizar a câmera na nuvem."); 
    }
  };

  const finalizeSave = (newIp) => {
    let finalUrl = "";
    const cleanIp = newIp.trim();

    if (cleanIp === "0") {
      finalUrl = 'local_webcam';
    } else {
      // Usa a URL DIRETA para velocidade máxima (sem lag)
      finalUrl = cleanIp.startsWith("http") ? cleanIp : `http://${cleanIp}:8080/video`;
    }

    setCameras([{ id: 1, url: finalUrl, zoom: 1, originalUrl: cleanIp }]);
    alert("SENTINEL SINCRONIZADO: Modo de Alta Velocidade Ativado!");
  };

  const toggleFullScreen = () => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen().catch(err => {
        console.error("Erro ao tentar tela cheia:", err);
      });
    } else {
      document.exitFullscreen();
    }
  };


  // 0. Listener para Logs e Configurações em Tempo Real (Apenas Firebase Nuvem)
  useEffect(() => {
    // 1. Ouvindo Histórico de Alertas (Nuvem)
    const q = query(collection(db, 'detect_history'), orderBy('timestamp', 'desc'), limit(20));
    const unsubscribeLogs = onSnapshot(q, (snapshot) => {
      const cloudLogs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setLogs(cloudLogs);
    });

    // 2. Ouvindo Configurações de Estado (Armado/Desarmado/Pânico) (Nuvem)
    const unsubscribeConfig = onSnapshot(doc(db, 'system', 'config'), (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        if (data.isPanic !== undefined && data.isPanic !== isPanicRef.current) setIsPanic(data.isPanic);
        if (data.isArmed !== undefined && data.isArmed !== isArmedRef.current) setIsArmed(data.isArmed);
        if (data.cameraIp !== undefined && data.cameraIp !== cameraIp) setCameraIp(data.cameraIp);
      }
    });

    return () => {
      unsubscribeLogs();
      unsubscribeConfig();
    };
  }, []);

  // 0.5. Integração com Telegram Bot (Envio Direto sem passar pelo Firebase Storage)
  const sendTelegramAlert = async (imageBase64, message) => {
    const TELEGRAM_BOT_TOKEN = '8218720602:AAGfIG_4bvo_wCbGf48XORKrsgLfZp_EIVo';
    const TELEGRAM_CHAT_ID = '5929838630';
    
    try {
      // Converter Base64 (data_url) para Blob
      const res = await fetch(imageBase64);
      const blob = await res.blob();

      const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`;
      const formData = new FormData();
      formData.append('chat_id', TELEGRAM_CHAT_ID);
      formData.append('photo', blob, 'intruso.jpg');
      formData.append('caption', `🚨 *GOGOMA SENTINEL* 🚨\n${message}\n🕒 Data: ${new Date().toLocaleString()}`);
      formData.append('parse_mode', 'Markdown');

      const response = await fetch(url, {
        method: 'POST',
        body: formData
      });
      
      const data = await response.json();
      if (!data.ok) {
        console.error("ALERTA DE SISTEMA (Erro Telegram):\n" + data.description);
      } else {
        console.log("FOTO ENTREGUE AO TELEGRAM! ID: " + data.result.message_id);
      }
    } catch(e) { 
      console.error("Erro de Rede Telegram: " + e.message); 
    }
  };

  useEffect(() => {
    const loadIA = async () => {
      console.log("🚀 [GOGOMA] Iniciando Carregamento da IA...");
      const MODELS_LIST = ['/models', 'https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights'];
      
      for (const url of MODELS_LIST) {
        try {
          console.log(`📡 [GOGOMA] Tentando carregar de: ${url}`);
          setStatus(`Calibrando IA (${url === '/models' ? 'Local' : 'Nuvem'})...`);
          
          await faceapi.nets.tinyFaceDetector.loadFromUri(url);
          console.log("✅ TinyFaceDetector OK");
          setStatus("Calibrando IA: 25%");
          
          await faceapi.nets.ssdMobilenetv1.loadFromUri(url);
          console.log("✅ SsdMobilenetv1 OK");
          setStatus("Calibrando IA: 50%");
          
          await faceapi.nets.faceLandmark68Net.loadFromUri(url);
          console.log("✅ FaceLandmark68 OK");
          setStatus("Calibrando IA: 75%");
          
          await faceapi.nets.faceRecognitionNet.loadFromUri(url);
          console.log("✅ FaceRecognitionNet OK");
          
          setIsModelsLoaded(true);
          setStatus("Sentinel Ativo");
          console.log("🌟 [GOGOMA] Modelos Carregados!");
          
          try { 
            await syncWithFirebase(); 
          } catch (e) { 
            console.warn("⚠️ Firebase Sync falhou", e); 
          }
          return;
        } catch (e) {
          console.error(`❌ Erro em ${url}:`, e);
          if (url === MODELS_LIST[MODELS_LIST.length - 1]) {
            setStatus("Erro Crítico: Falha Total de Modelos");
          }
        }
      }
    };
    const timer = setTimeout(() => {
      loadIA();
    }, 1000);
    return () => clearTimeout(timer);
  }, []);

  // 3. Vigilante de Latência (Watchdog) - Mata o atraso do áudio em tempo real
  useEffect(() => {
    if (!audioActive) {
      if (audioCtxRef.current) audioCtxRef.current.close();
      audioCtxRef.current = null;
      return;
    }
    
    const setupAudio = async () => {
      const audioEl = document.getElementById(`audio-${audioActive}`);
      if (!audioEl) return;

      if (!audioCtxRef.current) {
        audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
        gainNodeRef.current = audioCtxRef.current.createGain();
        audioSourceRef.current = audioCtxRef.current.createMediaElementSource(audioEl);
        audioSourceRef.current.connect(gainNodeRef.current);
        gainNodeRef.current.connect(audioCtxRef.current.destination);
      }
      
      // Aplicar Super Ganho se estiver ativo
      gainNodeRef.current.gain.value = isSuperAudio ? 4.0 : 1.0;
    };

    setupAudio();

    const interval = setInterval(() => {
      const audioEl = document.getElementById(`audio-${audioActive}`);
      if (audioEl && !audioEl.paused && audioEl.buffered.length > 0) {
        const lag = audioEl.buffered.end(audioEl.buffered.length - 1) - audioEl.currentTime;
        if (lag > 0.4) {
          // Se houver mais de 0.4s de atraso, acelera para alcançar o presente
          audioEl.playbackRate = 1.5;
        } else if (lag > 0.1) {
          audioEl.playbackRate = 1.1;
        } else {
          audioEl.playbackRate = 1.0;
        }
      }
    }, 500);
    return () => clearInterval(interval);
  }, [audioActive]);
  
  // 4. Lógica de Pânico (Strobe Light + Sirene)
  useEffect(() => {
    let panicInterval;
    let sirenInterval;
    
    if (isPanic) {
      // 1. Alarme de Intermitência Tática (Som + Vibração Acelerados)
      if (!audioCtxRef.current) audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
      audioCtxRef.current.resume();
      
      if (navigator.vibrate) navigator.vibrate([200, 100, 200, 100]);

      sirenInterval = setInterval(() => {
        const osc = audioCtxRef.current.createOscillator();
        const gain = audioCtxRef.current.createGain();
        osc.type = 'square';
        osc.connect(gain);
        gain.connect(audioCtxRef.current.destination);
        // Som mais agudo e rápido
        osc.frequency.setValueAtTime(1500, audioCtxRef.current.currentTime);
        gain.gain.setValueAtTime(0.6, audioCtxRef.current.currentTime);
        osc.start();
        osc.stop(audioCtxRef.current.currentTime + 0.1);
      }, 250);

      // 2. STROBE FLASH (300ms - Alta Intensidade)
      let strobeState = true;
      panicInterval = setInterval(() => {
        cameras.forEach(cam => {
          const baseUrl = cam.url.replace('/video', '');
          const cmd = strobeState ? 'enabletorch' : 'disabletorch';
          fetch(`${baseUrl}/${cmd}`, { mode: 'no-cors' }).catch(() => {});
        });
        strobeState = !strobeState;
      }, 300); 
    } else {
      if (navigator.vibrate) navigator.vibrate(0);
      cameras.forEach(cam => {
        const baseUrl = cam.url.replace('/video', '');
        fetch(`${baseUrl}/disabletorch`, { mode: 'no-cors' }).catch(() => {});
      });
    }

    return () => {
      clearInterval(panicInterval);
      clearInterval(sirenInterval);
    };
  }, [isPanic, cameras]);

  // 2. Sincronizar Perfis Autorizados do Firestore com Dados Completos
  const syncWithFirebase = async () => {
    try {
      const q = query(collection(db, 'users'));
      const snapshot = await getDocs(q);
      const labeledDescriptors = snapshot.docs.map(doc => {
        const data = doc.data();
        const descriptorArray = data.descriptor ? new Float32Array(data.descriptor) : null;
        // Armazenando dados extras no Label como JSON para recuperar na detecção
        const labelData = JSON.stringify({ 
          name: data.name, 
          cargo: data.cargo || 'Membro', 
          dept: data.departamento || 'Geral' 
        });
        return descriptorArray ? new faceapi.LabeledFaceDescriptors(labelData, [descriptorArray]) : null;
      }).filter(Boolean);
      
      if (labeledDescriptors.length > 0) {
        // Tolerância de 0.5 para reconhecimento rigoroso (Evita falsos positivos)
        setFaceMatcher(new faceapi.FaceMatcher(labeledDescriptors, 0.5));
        setDebugStatus(`IA: ${labeledDescriptors.length} Membros Ativos`);
      } else {
        setFaceMatcher(null);
        setDebugStatus("Base de Membros Vazia");
      }
    } catch (e) { 
      console.warn('Sem usuarios no Firebase ainda.'); 
      setFaceMatcher(null);
    }
  };

  // 3. Motor de Duas Velocidades: Vídeo Fluido (FPS) + Radar IA (Segundo Plano)
  useEffect(() => {
    let iaTimeout;
    let animationFrame;
    
    if (isModelsLoaded && view === 'monitor') {
      // --- LOOP 1: RENDERIZAÇÃO DE VÍDEO (ULTRA-RÁPIDO) ---
      const renderFrames = () => {
        cameras.forEach((cam, i) => {
          const video = cameraRefs.current[i];
          const canvas = canvasRefs.current[i];
          
          if (video && canvas) {
            try {
              const ctx = canvas.getContext('2d');
              if (!ctx) return;
              
              // Sincronizar tamanho do Canvas com o tamanho de exibição do vídeo (Dual-Layer Sync)
              if (canvas.width !== video.clientWidth || canvas.height !== video.clientHeight) {
                canvas.width = video.clientWidth;
                canvas.height = video.clientHeight;
              }

              // LIMPAR O CANVAS (Para manter a transparência e ver o vídeo por baixo)
              ctx.clearRect(0, 0, canvas.width, canvas.height);

              // DESENHAR OVERLAYS TÁTICOS (ESTILO NEXT-GEN)
              const activeDetections = detectionsByCamRef.current[cam.id] || [];
              activeDetections.forEach(det => {
                const { box, label, credentials, isRecognized, verifying } = det;
                const scanLinePos = (Math.sin(Date.now() / 200) * 0.5 + 0.5) * box.height;
                
                // 1. COR DO HUD
                let hudColor = '#f59e0b'; // Amarelo (Analisando)
                if (isRecognized) hudColor = '#3b82f6'; // Azul (Membro)
                else if (!verifying) hudColor = '#ef4444'; // Vermelho (Intruso)

                // 2. CAIXA PRINCIPAL
                ctx.strokeStyle = hudColor;
                ctx.lineWidth = 2;
                ctx.setLineDash([10, 5]);
                ctx.strokeRect(box.x, box.y, box.width, box.height);
                ctx.setLineDash([]); // Reset dash

                // Cantoneiras (Corners) - Efeito Profissional
                const cSize = 15;
                ctx.beginPath();
                ctx.lineWidth = 4;
                // Top Left
                ctx.moveTo(box.x, box.y + cSize); ctx.lineTo(box.x, box.y); ctx.lineTo(box.x + cSize, box.y);
                // Top Right
                ctx.moveTo(box.x + box.width - cSize, box.y); ctx.lineTo(box.x + box.width, box.y); ctx.lineTo(box.x + box.width, box.y + cSize);
                // Bottom Left
                ctx.moveTo(box.x, box.y + box.height - cSize); ctx.lineTo(box.x, box.y + box.height); ctx.lineTo(box.x + cSize, box.y + box.height);
                // Bottom Right
                ctx.moveTo(box.x + box.width - cSize, box.y + box.height); ctx.lineTo(box.x + box.width, box.y + box.height); ctx.lineTo(box.x + box.width, box.y + box.height - cSize);
                ctx.stroke();

                // 3. LINHA DE SCAN (LASER)
                ctx.strokeStyle = hudColor;
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(box.x, box.y + scanLinePos);
                ctx.lineTo(box.x + box.width, box.y + scanLinePos);
                ctx.stroke();
                // Glow do laser
                ctx.shadowBlur = 10; ctx.shadowColor = hudColor; ctx.stroke(); ctx.shadowBlur = 0;

                // 4. ETIQUETA DE IDENTIFICAÇÃO
                ctx.fillStyle = hudColor;
                const headerH = isRecognized ? 50 : 25;
                ctx.fillRect(box.x, box.y - headerH - 5, box.width, headerH);
                
                ctx.fillStyle = '#fff';
                ctx.font = '900 10px Inter';
                
                if (isRecognized && credentials) {
                  ctx.fillText("✓ ACESSO AUTORIZADO", box.x + 8, box.y - 38);
                  ctx.font = 'bold 13px Inter';
                  ctx.fillText(credentials.name.toUpperCase(), box.x + 8, box.y - 22);
                  ctx.font = '500 9px Inter';
                  ctx.fillText(`${credentials.cargo} | ${credentials.dept}`, box.x + 8, box.y - 10);
                } else if (verifying) {
                  ctx.fillText("🔍 SCANNING BIOMETRICS...", box.x + 8, box.y - 12);
                } else {
                  ctx.fillText("⚠️ ALVO DESCONHECIDO", box.x + 8, box.y - 12);
                  ctx.font = 'bold 9px Inter';
                  ctx.fillStyle = 'rgba(255,255,255,0.7)';
                  ctx.fillText("ALERTA DE SEGURANÇA", box.x + 8, box.y + box.height + 15);
                }
              });

              // INDICADOR DE ATIVIDADE IA (Ponto no Canto)
              ctx.fillStyle = '#10b981';
              ctx.beginPath();
              ctx.arc(10, 10, 3, 0, Math.PI * 2);
              ctx.fill();
            } catch (err) {
              console.error("Erro Crítico de Vídeo:", err);
            }
          }

        });
        animationFrame = requestAnimationFrame(renderFrames);
      };
      renderFrames();

      // --- LOOP 2: RADAR IA (SEGUNDO PLANO - ULTRA-OTIMIZADO) ---
      let currentCamIndex = 0;

      const runIA = async () => {
        if (cameras.length === 0 || view !== 'monitor') {
          iaTimeout = setTimeout(runIA, 1000);
          return;
        }
        const i = currentCamIndex % cameras.length;
        const cam = cameras[i]; // Define a câmera atual
        currentCamIndex++;
        
        const video = cameraRefs.current[i];
        const canvas = canvasRefs.current[i];
        if (!video || !canvas || video.naturalWidth === 0) {
          iaTimeout = setTimeout(runIA, 500);
          return;
        }

        try {
          // MOTOR TÁTICO OTIMIZADO (160px para Velocidade Máxima, scoreThreshold reduzido para alvos distantes)
          const detections = await faceapi.detectAllFaces(video, new faceapi.TinyFaceDetectorOptions({ inputSize: 160, scoreThreshold: 0.35 }))
            .withFaceLandmarks().withFaceDescriptors();

          // --- DETECÇÃO DE MOVIMENTO (OTIMIZADA E ULTRA-SENSÍVEL) ---
          let hasSignificantMotion = false;
          if (isArmed && !isPanic) {
            if (!motionCanvasRef.current) {
              motionCanvasRef.current = document.createElement('canvas');
              motionCanvasRef.current.width = MOTION_WIDTH; 
              motionCanvasRef.current.height = MOTION_HEIGHT;
            }

            const mCanvas = motionCanvasRef.current;
            const mCtx = mCanvas.getContext('2d', { willReadFrequently: true });
            mCtx.drawImage(video, 0, 0, MOTION_WIDTH, MOTION_HEIGHT);
            const currentFrame = mCtx.getImageData(0, 0, MOTION_WIDTH, MOTION_HEIGHT).data;
            
            if (prevFrameRef.current) {
              let diff = 0;
              for (let j = 0; j < currentFrame.length; j += 4) {
                // Compara apenas o canal verde para velocidade e sensibilidade
                diff += Math.abs(currentFrame[j+1] - prevFrameRef.current[j+1]);
              }
              // Limiar de movimento reduzido drasticamente para captar vultos e pessoas distantes
              if (diff > 5000) hasSignificantMotion = true; 
            }
            prevFrameRef.current = currentFrame;
          }

          if (detections.length > 0) {
            setDebugStatus(`Alvo(s) em movimento...`);

            const dims = { width: canvas.width, height: canvas.height };
            const resizedDetections = faceapi.resizeResults(detections, dims);

            const newDetections = resizedDetections.map(resized => {
              const box = resized.detection.box;
              if (box.width < 20) return null; // Limiar reduzido de 70 para 20 para permitir detecção a longa distância
              let label = 'Desconhecido';
              let credentials = null;
              let isRecognized = false;
              let verifying = false;
              
              if (faceMatcher && resized.descriptor) {
                const match = faceMatcher.findBestMatch(resized.descriptor);
                
                if (!detectionBuffer.current[cam.id]) detectionBuffer.current[cam.id] = [];
                detectionBuffer.current[cam.id].push(match.label);
                if (detectionBuffer.current[cam.id].length > 8) detectionBuffer.current[cam.id].shift();

                const counts = detectionBuffer.current[cam.id].reduce((acc, val) => {
                  acc[val] = (acc[val] || 0) + 1;
                  return acc;
                }, {});
                const bestLabel = Object.keys(counts).reduce((a, b) => counts[a] > counts[b] ? a : b);
                
                if (detectionBuffer.current[cam.id].length >= 3) {
                  if (bestLabel !== 'unknown' && counts[bestLabel] >= 3) {
                    try { 
                      credentials = JSON.parse(bestLabel);
                      label = credentials.name; 
                      isRecognized = true;
                      verifying = false;
                    } catch(e) { label = bestLabel; }
                  } else if (bestLabel === 'unknown' && counts[bestLabel] >= 4) {
                    isRecognized = false;
                    verifying = false;
                  } else {
                    verifying = true;
                  }
                } else {
                  verifying = true;
                }
              }

              return { box, label, credentials, isRecognized, verifying, descriptor: resized.descriptor };
            }).filter(Boolean);

            detectionsByCamRef.current[cam.id] = newDetections;
            
            try {
              const lastRec = newDetections.find(d => d.isRecognized);
              if (lastRec && lastRec.credentials) {
                setIdentifiedName(`${lastRec.credentials.name} | ${lastRec.credentials.cargo}`);
              } else if (newDetections.length > 0) {
                setIdentifiedName(newDetections.some(d => d.verifying) ? 'Identificando...' : 'Desconhecido');
              } else {
                setIdentifiedName('');
              }
            } catch (err) {
              setIdentifiedName('Erro de Sincronização');
            }

            // GATILHO DE PANICO E CAPTURA (COM GRACE PERIOD)
            const currentTimeMs = Date.now();
            const gracePeriodMs = 60000; 
            const inGracePeriod = (currentTimeMs - lastResidentRef.current) < gracePeriodMs;

            const hasUnrecognizedIntruder = newDetections.some(d => !d.isRecognized && !d.verifying);
            const hasResident = newDetections.some(d => d.isRecognized);

            if (hasResident) {
                if (lastResidentRef.current === 0 || (currentTimeMs - lastResidentRef.current) > 5000) {
                    console.log("🛡️ [GOGOMA] RESIDENTE IDENTIFICADO. Protocolo de Cortesia Ativado (Grace Period 60s).");
                }
                lastResidentRef.current = currentTimeMs;
            }

            if (isArmedRef.current && !isPanicRef.current && !inGracePeriod) {
                if (hasUnrecognizedIntruder) {
                    console.log("🚨 [GOGOMA] INTRUSO DETECTADO FORA DO GRACE PERIOD!");
                    setIsPanic(true);
                    isPanicRef.current = true;
                    fetch('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isPanic: true }) }).catch(() => {});
                    setDoc(doc(db, 'system', 'config'), { isPanic: true }, { merge: true }).catch(() => {});
                }
            }

            newDetections.forEach(det => {
               if (isArmed && (!window.lastSaveTime || Date.now() - window.lastSaveTime > 15000)) {
                  window.lastSaveTime = Date.now();
                  const sCanvas = document.createElement('canvas');
                  sCanvas.width = video.naturalWidth || 1280; sCanvas.height = video.naturalHeight || 720;
                  sCanvas.getContext('2d').drawImage(video, 0, 0);
                  const shot = sCanvas.toDataURL('image/jpeg', 0.5);
                  saveActivityLog(det, shot, det.label, i + 1, det.isRecognized);
               }
            });
          } else if (cam) {
            detectionsByCamRef.current[cam.id] = [];
            // Detecção de Movimento mesmo sem rostos
            const currentTimeMs = Date.now();
            if (isArmedRef.current && !isPanicRef.current && !inGracePeriod && hasSignificantMotion) {
                // Apenas logamos o movimento, mas não disparamos o pânico bruto para evitar animais/aves.
                // O pânico agora depende da detecção de ROSTO (JS) ou CORPO HUMANO (Python).
                console.log("☁️ [GOGOMA] Movimento detectado (Analisando biometria...)");
            }
          }
        } catch(e) { 
          console.error("Erro IA:", e);
          setDebugStatus(`ERRO IA: ACESSO AO VÍDEO NEGADO`);
        }
        
        iaTimeout = setTimeout(runIA, 500); // Aumentado para 500ms para reduzir carga na CPU e acabar com o lag
      };

      runIA();

    }
    
    return () => {
      clearTimeout(iaTimeout);
      cancelAnimationFrame(animationFrame);
    };
  }, [isModelsLoaded, view, faceMatcher, cameras, isArmed, nightModeCams]);

  // --- 5. FUNÇÕES DE CONTROLE ELITE ---
  const toggleFlash = (url, state) => {
    try {
      const baseUrl = url.replace('/video', '');
      fetch(`${baseUrl}/${state ? 'enabletorch' : 'disabletorch'}`, { mode: 'no-cors' });
    } catch(e) { console.error("Erro Flash:", e); }
  };

  // 4. Protocolo de Segurança e Log Forense (Unificado)
  const saveActivityLog = async (detection, image, label, camId = 1, isAuthorized = false) => {
    const timestamp = new Date().toISOString();

    // 1. SALVAMENTO LOCAL (Removido - 100% Nuvem agora)
    // O salvamento agora vai direto para o Firebase no passo 3.

    // 2. Telegram (Resiliente)
    if (!isAuthorized) {
      try {
        const alertType = label === 'Ameaça Hostil' ? '🚨 AMEAÇA HOSTIL' : '⚠️ INTRUSO';
        sendTelegramAlert(image, `${alertType}\nLocal: CAM ${camId}`);
      } catch(e) { console.warn('Telegram Lento'); }
    }

    // 3. Firebase com MODO DE RESILIÊNCIA
    try {
      let finalUrl = image; 
      try {
        const fileName = `${isAuthorized ? 'res' : 'unk'}_${Date.now()}.jpg`;
        const storageRef = ref(storage, `detect_history/${fileName}`);
        const uploadTask = await uploadString(storageRef, image, 'data_url');
        finalUrl = await getDownloadURL(uploadTask.ref);
      } catch (storageErr) { console.warn("Usando Base64 para nuvem."); }

      await addDoc(collection(db, 'detect_history'), {
        descriptor: Array.from(detection.descriptor),
        imageUrl: finalUrl,
        timestamp: serverTimestamp(),
        label,
        camId,
        status: isAuthorized ? 'Acesso Autorizado' : (label === 'Ameaça Hostil' ? 'Ameaça Hostil' : 'Alvo Desconhecido')
      });
      setStatus('Sentinel Ativo');
    } catch (e) { 
      console.error('Erro Total de Rede:', e.message);
      setStatus(`ERRO DE REDE: ${e.message}`);
    }
  };

  if (!isModelsLoaded && !status.includes('Erro')) {
    return (
      <div className="min-h-screen bg-[#080a0e] flex flex-col items-center justify-center text-white p-10 font-sans relative overflow-hidden">
        <div className="absolute inset-0 bg-blue-600/5 animate-pulse"></div>
        <Shield className="text-blue-500 animate-bounce mb-6 relative z-10" size={80} />
        <h1 className="text-4xl font-black tracking-tighter mb-2 relative z-10">GOGOMA <span className="text-blue-500">SENTINEL</span></h1>
        <p className="text-zinc-500 uppercase tracking-widest text-xs mb-8 relative z-10 font-mono">Inicializando Protocolos de Defesa v3</p>
        <div className="bg-blue-600/10 border border-blue-500/30 px-8 py-4 rounded-3xl flex flex-col items-center gap-4 relative z-10 backdrop-blur-xl min-w-[300px]">
          <div className="flex items-center gap-4">
            <Loader2 className="animate-spin text-blue-400" size={24} />
            <div className="flex flex-col">
              <span className="text-blue-400 font-black font-mono text-sm tracking-tighter">{String(status || 'Standby').toUpperCase()}</span>
              <span className="text-[10px] text-zinc-500 font-mono">Aguardando resposta dos sensores...</span>
            </div>
          </div>
          <div className="w-full bg-white/5 h-1 rounded-full overflow-hidden">
            <div 
              className="h-full bg-blue-500 transition-all duration-500" 
              style={{ width: status.includes('25%') ? '25%' : (status.includes('50%') ? '50%' : (status.includes('75%') ? '75%' : (isModelsLoaded ? '100%' : '10%'))) }}
            ></div>
          </div>
        </div>

        <div className="mt-8 flex flex-col items-center gap-2 z-10">
          <button 
            onClick={() => {
              localStorage.clear();
              window.location.reload();
            }}
            className="text-[9px] text-zinc-600 hover:text-red-500 transition-colors uppercase font-mono tracking-tighter border-b border-zinc-800"
          >
            [ LIMPAR CACHE E FORÇAR HARD RESET ]
          </button>
        </div>
      </div>
    );
  }

  if (status.includes('Erro')) {
    return (
      <div className="min-h-screen bg-red-950/20 flex flex-col items-center justify-center text-white p-10 font-sans backdrop-blur-3xl">
        <AlertCircle className="text-red-500 mb-6" size={80} />
        <h1 className="text-3xl font-black mb-2 uppercase tracking-tighter">Falha de Inicialização</h1>
        <p className="text-red-400 font-mono text-sm mb-8 bg-red-500/10 px-4 py-2 rounded-lg border border-red-500/20">{status}</p>
        <button 
          onClick={() => window.location.reload()}
          className="bg-white text-black px-8 py-3 rounded-2xl font-black hover:bg-zinc-200 transition-all flex items-center gap-2 mb-4"
        >
          <RefreshCw size={20}/> REINICIAR SISTEMA
        </button>
        <button 
          onClick={() => setIsModelsLoaded(true)}
          className="text-zinc-500 text-[10px] font-mono hover:text-white transition-colors"
        >
          [ IGNORAR ERRO E FORÇAR ENTRADA NO MONITOR ]
        </button>
      </div>
    );
  }

  console.log("🖥️ [GOGOMA] Renderizando UI Principal | View:", view, "Models Loaded:", isModelsLoaded);
  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-[#0a0a0c] text-zinc-100 font-sans p-6 overflow-hidden flex flex-col">
        {/* BARRA DE DIAGNÓSTICO GOGOMA */}
        <div className="fixed top-0 left-0 right-0 z-[9999] bg-blue-600 text-white text-[10px] font-black px-4 py-1 flex justify-between items-center shadow-2xl">
          <span>GOGOMA SENTINEL V3 // DIAGNÓSTICO ATIVO</span>
          <span>STATUS: {status.toUpperCase()} | IA: {isModelsLoaded ? 'ONLINE' : 'CARREGANDO...'} | MEMBROS: {faceMatcher ? faceMatcher.labeledDescriptors.length : 0} | VIEW: {view.toUpperCase()}</span>
        </div>

        {/* Header Profissional */}
        <header className="flex justify-between items-center mb-8 border-b border-white/5 pb-4">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-blue-600/20 rounded-xl flex items-center justify-center border border-blue-500/40">
              <Shield className="text-blue-500" size={28} />
            </div>
            <div>
              <h1 className="text-2xl font-black tracking-tighter flex items-center gap-2">
                GOGOMA <span className="text-blue-500 italic">SENTINEL v3</span>
                <span className="text-[10px] bg-red-600 text-white px-2 py-0.5 rounded-full uppercase font-bold tracking-widest">Sala de Segurança</span>
              </h1>
              <p className="text-xs text-zinc-500 font-mono mt-1">SISTEMA MULTI-CÂMERAS IP | MOSAICO</p>
            </div>
          </div>
          
          <nav className="flex items-center gap-3">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 bg-white/5 p-1 rounded-xl border border-white/10">
                <input 
                  type="text" 
                  placeholder="IP Rápido (ex: 192.168.1.5)" 
                  value={cameraIp}
                  onChange={(e) => setCameraIp(e.target.value)}
                  className="bg-transparent border-none text-[10px] font-mono px-3 py-1 focus:ring-0 w-32"
                />
                <button 
                  onClick={() => saveCameraIp(cameraIp)}
                  className="bg-blue-600 hover:bg-blue-500 text-white p-2 rounded-lg transition-all"
                  title="Sincronizar IA com este IP"
                >
                  <RefreshCw size={12} />
                </button>
              </div>

              <button 
                onClick={() => setCameras([...cameras, { id: Date.now(), url: 'http://192.168.1.X:8080/video', zoom: 1 }])}
                className="px-4 py-2 rounded-xl text-xs font-black transition-all flex items-center gap-2 shadow-lg border bg-zinc-800 text-white border-zinc-700 hover:bg-zinc-700"
              >
                <Camera size={14} /> ADICIONAR CÂMERA IP
              </button>
            </div>
            {/* BOTÃO DO CADEADO (Sincronizado com Servidor) */}
            <button 
              onClick={() => { 
                const newArmed = !isArmed;
                setIsArmed(newArmed); 
                if (!newArmed) setIsPanic(false); // Mata o pânico localmente
                setStatus(newArmed ? 'Sentinel Vigilante' : 'Sentinel em Espera');
                
                // Sincroniza estado e reseta pânico se desarmar
                const payload = { isArmed: newArmed };
                if (!newArmed) payload.isPanic = false;

                fetch('/api/config', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(payload)
                }).catch(e => console.error("Erro ao sincronizar estado armado:", e));
              }}
              className={`px-4 py-2 rounded-xl text-sm font-black transition-all flex items-center gap-2 shadow-xl border ${isArmed ? 'bg-blue-600 text-white border-blue-400 animate-pulse' : 'bg-zinc-800 text-zinc-500 border-zinc-700'}`}>
              {isArmed ? <Lock size={16} /> : <Unlock size={16} />}
              {isArmed ? 'VIGILÂNCIA ATIVA' : 'SISTEMA DESARMADO'}
            </button>

            <div className="flex bg-white/5 p-1 rounded-xl border border-white/5">
              <button onClick={() => setView('monitor')} className={`px-4 py-2 rounded-lg text-sm font-bold transition-all flex items-center gap-2 ${view === 'monitor' ? 'bg-blue-600 text-white shadow-lg' : 'text-zinc-400 hover:text-zinc-200'}`}><Layout size={16}/> Monitor</button>
              <button onClick={() => setView('register')} className={`px-4 py-2 rounded-lg text-sm font-bold transition-all flex items-center gap-2 ${view === 'register' ? 'bg-blue-600 text-white shadow-lg' : 'text-zinc-400 hover:text-zinc-200'}`}><UserPlus size={16}/> Cadastro</button>
              <button onClick={() => setView('search')} className={`px-4 py-2 rounded-lg text-sm font-bold transition-all flex items-center gap-2 ${view === 'search' ? 'bg-blue-600 text-white shadow-lg' : 'text-zinc-400 hover:text-zinc-200'}`}><Search size={16}/> Busca Histórica</button>
              <button onClick={() => setView('admin')} className={`px-4 py-2 rounded-lg text-sm font-bold transition-all flex items-center gap-2 ${view === 'admin' ? 'bg-blue-600 text-white shadow-lg' : 'text-zinc-400 hover:text-zinc-200'}`}><Settings size={16}/> Gestão de Membros</button>
              <button 
                onClick={() => {
                  const newPanic = !isPanic;
                  if (!newPanic && audioCtxRef.current) audioCtxRef.current.resume();
                  setIsPanic(newPanic);
                  // Sincroniza com o servidor
                  fetch('/api/config', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ isPanic: newPanic, manual: true })
                  }).catch(e => console.error("Erro ao sincronizar pânico:", e));
                }} 
                className={`px-6 py-2 rounded-xl text-xs font-black transition-all flex items-center gap-2 border-2 shadow-[0_0_20px_rgba(220,38,38,0.4)] ${isPanic ? 'bg-red-600 text-white animate-pulse border-white' : 'bg-red-600/10 text-red-500 border-red-500/30 hover:bg-red-600 hover:text-white'}`}
              >
                <Zap size={16}/> {isPanic ? 'PARAR PÂNICO' : 'BOTÃO DE PÂNICO'}
              </button>
            </div>
          </nav>
        </header>

        {/* Main View */}
        <main className="flex-1">
          {view === 'monitor' && (
            <div className="grid grid-cols-12 gap-8 h-full">
              <div className="col-span-9 relative group">
                <div ref={containerRef} className="relative rounded-3xl overflow-hidden shadow-2xl bg-[#111] h-[650px] p-4 border border-white/5">
                  
                  {/* Mosaico Grid (Aberto por Padrão) */}
                  <div style={{ transform: `scale(${zoom})`, transformOrigin: 'top center', transition: 'transform 0.3s' }} 
                       className={`w-full h-full grid gap-6 ${cameras.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
                    
                    {cameras.map((cam, i) => (
                      <div key={cam.id} className="relative rounded-2xl overflow-hidden border-2 border-blue-500/30 bg-[#050505] min-h-[300px]">
                        
                        {/* IP Input (SEMPRE NO TOPO) */}
                        <div className="absolute top-2 left-2 z-[100] flex flex-col gap-2">
                          <div className="bg-black/90 p-3 rounded-2xl border-2 border-blue-500/40 flex items-center gap-3 shadow-[0_0_30px_rgba(0,0,0,0.8)]">
                            <span className="text-xs font-black text-blue-400">IP:</span>
                            <input 
                              type="text" 
                              value={cam.url}
                              onChange={(e) => {
                                const newCams = [...cameras];
                                newCams[i].url = e.target.value;
                                saveCameras(newCams);
                              }}
                              className="bg-transparent border-b border-blue-500/20 text-sm text-white font-mono outline-none w-56 focus:border-blue-500"
                            />
                          </div>
                          
                          <div className="flex gap-3">
                            <button 
                              onClick={() => {
                                const newNightModes = new Set(nightModeCams);
                                if (newNightModes.has(cam.id)) newNightModes.delete(cam.id);
                                else newNightModes.add(cam.id);
                                setNightModeCams(newNightModes);
                              }}
                              className={`px-4 py-2 rounded-xl text-xs font-black flex items-center gap-2 shadow-2xl transition-all border-2 ${nightModeCams.has(cam.id) ? 'bg-green-600 text-white border-green-400 animate-pulse' : 'bg-zinc-800 text-zinc-400 border-zinc-700'}`}
                            >
                              <Shield size={16}/> {nightModeCams.has(cam.id) ? 'NOITE: ON' : 'MODO NOITE'}
                            </button>

                            <button 
                              onClick={() => toggleFlash(cam.url, true)}
                              className="bg-amber-500 hover:bg-amber-400 text-black px-4 py-2 rounded-xl text-xs font-black flex items-center gap-2 shadow-2xl border-2 border-amber-600"
                            >
                              <Zap size={16}/> LUZ ON
                            </button>
                            
                            <button 
                              onClick={() => toggleFlash(cam.url, false)}
                              className="bg-zinc-800 hover:bg-zinc-700 text-white px-4 py-2 rounded-xl text-xs font-black border-2 border-zinc-700"
                            >
                              OFF
                            </button>

                            {/* ZOOM INDIVIDUAL (MAIOR E MAIS VISÍVEL) */}
                            <div className="flex items-center gap-2 bg-black/60 backdrop-blur-md rounded-xl px-4 border-2 border-blue-500/40 shadow-2xl">
                              <button onClick={() => updateCamZoom(cam.id, -0.2)} className="text-white hover:text-blue-400 p-2 transform active:scale-90 transition-transform"><ZoomOut size={18}/></button>
                              <span className="text-xs font-black font-mono text-blue-400 w-12 text-center">{Math.round((cam.zoom || 1) * 100)}%</span>
                              <button onClick={() => updateCamZoom(cam.id, 0.2)} className="text-white hover:text-blue-400 p-2 transform active:scale-90 transition-transform"><ZoomIn size={18}/></button>
                            </div>

                            <button 
                              onClick={() => {
                                const audioId = `audio-${cam.id}`;
                                const audioEl = document.getElementById(audioId);
                                if (audioActive !== cam.id) {
                                  audioEl.src = cam.url.replace('/video', '/audio.wav') + '?t=' + Date.now();
                                  audioEl.play().catch(e => console.warn("Clique para áudio"));
                                  setAudioActive(cam.id);
                                } else {
                                  audioEl.pause(); audioEl.src = '';
                                  setAudioActive(null);
                                }
                              }}
                              className={`px-3 py-1 rounded-lg text-[10px] font-black transition-all ${audioActive === cam.id ? 'bg-amber-500 text-black animate-pulse' : 'bg-blue-600 text-white'}`}
                            >
                              <Users size={12}/> {audioActive === cam.id ? 'OUVINDO...' : 'ESCUTA'}
                            </button>
                          </div>
                        </div>

                        <div className="absolute top-2 right-2 z-[100] flex gap-2">
                          <button 
                            onClick={() => {
                              const container = cameraRefs.current[i].parentElement;
                              if (!document.fullscreenElement) container.requestFullscreen();
                              else document.exitFullscreen();
                            }}
                            className="bg-blue-600 hover:bg-blue-500 text-white p-2 rounded-xl shadow-lg transition-all"
                            title="Foco Individual"
                          >
                            <Maximize size={14}/>
                          </button>
                          <button 
                            onClick={() => saveCameras(cameras.filter(c => c.id !== cam.id))}
                            className="bg-red-600 hover:bg-red-500 text-white p-2 rounded-xl shadow-lg transition-all"
                            title="Remover Câmera"
                          >
                            <Trash2 size={14}/>
                          </button>
                        </div>

                        {/* VÍDEO NATIVO E IA (COM ZOOM INDEPENDENTE) */}
                        <div className="absolute inset-0 overflow-hidden bg-zinc-900">
                          <img 
                            ref={el => cameraRefs.current[i] = el} 
                            src={cam.url} 
                            crossOrigin="anonymous" 
                            className="w-full h-full object-contain transition-all duration-500" 
                            style={{ 
                              display: 'block', 
                              zIndex: 10,
                              transform: `scale(${cam.zoom || 1})`,
                              filter: nightModeCams.has(cam.id) ? 'brightness(2) contrast(1.2) grayscale(1) sepia(1) hue-rotate(85deg) saturate(2)' : 'none'
                            }}
                            onError={(e) => {
                              const errDiv = document.createElement('div');
                              errDiv.className = "absolute inset-0 flex flex-col items-center justify-center p-4 text-center z-[11] bg-red-950/80";
                              errDiv.innerHTML = `<p class='text-red-500 font-bold'>ERRO DE CONEXÃO</p><p class='text-[10px] text-zinc-400'>URL: ${cam.url}</p>`;
                              if(e.target.parentElement) e.target.parentElement.appendChild(errDiv);
                            }}
                          />

                          <audio id={`audio-${cam.id}`} src="" preload="none" crossOrigin="anonymous" />

                          <canvas 
                            ref={el => canvasRefs.current[i] = el} 
                            className="absolute inset-0 pointer-events-none w-full h-full object-contain z-[20]" 
                            style={{ transform: `scale(${cam.zoom || 1})` }}
                          />
                        </div>

                        <div className="absolute bottom-2 right-2 z-[30] bg-green-600/20 border border-green-500/40 px-2 py-1 rounded text-[8px] font-black text-green-500 animate-pulse">
                          LIVE SIGNAL
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="absolute bottom-6 right-6 flex flex-col gap-3 z-50">
                    <button onClick={toggleFullScreen} className="bg-black/60 backdrop-blur-md p-3 rounded-xl hover:bg-blue-600 text-white border border-white/20 transition-all shadow-xl">
                      {isFullscreen ? <Minimize size={20} /> : <Maximize size={20} />}
                    </button>
                    <div className="bg-black/60 backdrop-blur-md p-2 rounded-xl border border-white/20 flex flex-col items-center gap-3 shadow-xl">
                      <button onClick={() => setZoom(z => Math.min(z + 0.2, 4))} className="p-2 hover:bg-white/10 rounded-lg text-zinc-300 hover:text-white transition-all"><ZoomIn size={20} /></button>
                      <span className="text-[10px] font-mono font-bold text-blue-400 bg-blue-500/10 px-2 py-1 rounded-md">{Math.round(zoom * 100)}%</span>
                      <button onClick={() => setZoom(z => Math.max(z - 0.2, 1))} className="p-2 hover:bg-white/10 rounded-lg text-zinc-300 hover:text-white transition-all"><ZoomOut size={20} /></button>
                    </div>
                  </div>

                  <div className="absolute bottom-8 left-8 flex gap-4 z-40">
                    <div className="glass-card px-6 py-3 rounded-2xl flex items-center gap-4">
                      <div className={`w-3 h-3 rounded-full ${identifiedName.includes('Desconhecido') ? 'bg-red-500 animate-pulse' : (identifiedName.includes('Suspeito') ? 'bg-amber-500 animate-bounce' : (identifiedName ? 'bg-blue-500 pulse-blue' : 'bg-gray-500'))}`}></div>
                      <div>
                        <p className="text-[10px] uppercase font-black text-zinc-500 tracking-widest">Alvos Detectados</p>
                        <p className={`text-xl font-mono font-bold ${String(identifiedName).includes('Desconhecido') ? 'text-red-500' : (String(identifiedName).includes('Suspeito') ? 'text-amber-500' : 'text-blue-500')}`}>{identifiedName ? String(identifiedName).toUpperCase() : 'NENHUM ALVO'}</p>
                        <p className="text-[9px] font-mono text-zinc-600 mt-1">SISTEMA: {String(debugStatus || 'OK').toUpperCase()}</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <div className="col-span-3 flex flex-col gap-4">
                 <div className="bg-white/5 border border-white/5 rounded-3xl p-6 flex-1 flex flex-col overflow-hidden">
                    <div className="flex justify-between items-center mb-4">
                      <h3 className="text-sm font-black uppercase text-zinc-500 flex items-center gap-2"><History size={16}/> EVIDÊNCIAS FORENSES</h3>
                      <button 
                        onClick={async () => {
                          if (window.confirm("🚨 LIMPEZA TOTAL SOLICITADA?\nDeseja apagar TODAS as evidências?")) {
                            if (window.confirm("⚠️ ÚLTIMO AVISO: Ação irreversível. Confirmar?")) {
                              try {
                                setStatus("Limpando...");
                                
                                // 1. Limpar Nuvem (Firebase)
                                const q = query(collection(db, 'detect_history'));
                                const snap = await getDocs(q);
                                await Promise.all(snap.docs.map(d => deleteDoc(doc(db, 'detect_history', d.id))));
                                
                                // 2. Limpar Local (Server API)
                                await fetch('/api/logs', { method: 'DELETE' });
                                
                                setLogs([]);
                                setStatus("Arquivo Limpo.");
                                alert("ARQUIVO DE EVIDÊNCIAS FOI COMPLETAMENTE ELIMINADO.");
                              } catch(e) { 
                                console.error("Erro ao limpar:", e);
                                setStatus("Erro: " + e.message); 
                              }
                            }
                          }
                        }}
                        className="text-[10px] font-black bg-red-600/10 hover:bg-red-600 text-red-500 hover:text-white px-3 py-1 rounded-lg border border-red-500/20 transition-all flex items-center gap-1"
                      >
                        <Trash2 size={12}/> LIMPAR
                      </button>
                    </div>
                    <div className="flex-1 overflow-y-auto space-y-4 pr-2">
                      {logs.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-40 text-center border-2 border-dashed border-white/5 rounded-3xl">
                          <Shield className="text-zinc-800 mb-2" size={32} />
                          <p className="text-zinc-500 font-bold text-xs uppercase tracking-tighter">Vigilância Ativa</p>
                          <p className="text-zinc-600 text-[10px]">Aguardando detecção...</p>
                        </div>
                      ) : (
                        logs.map(log => (
                          <div key={log.id} className="flex gap-3 bg-black/50 p-3 rounded-2xl border border-white/5 items-center">
                            <div className="w-12 h-12 rounded-xl overflow-hidden border border-white/10 cursor-zoom-in hover:border-blue-500" onClick={() => setSelectedImage(log.imageUrl)}>
                              <img src={log.imageUrl} className="w-full h-full object-cover" />
                            </div>
                            <div className="flex-1">
                              <p className={`text-xs font-bold ${log.status === 'Oculto/Suspeito' ? 'text-amber-500' : 'text-red-500'}`}>
                                {String(log.status || log.label || 'ALERTA').toUpperCase()}
                              </p>
                              <p className="text-[10px] text-zinc-500">
                                {log.timestamp ? (
                                  typeof log.timestamp.toDate === 'function' 
                                    ? log.timestamp.toDate().toLocaleString() 
                                    : (!isNaN(new Date(log.timestamp).getTime()) ? new Date(log.timestamp).toLocaleString() : 'Data Inválida')
                                ) : '...'}
                              </p>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                 </div>
              </div>
            </div>
          )}

          {view === 'register' && <RegisterView cameras={cameras} isModelsLoaded={isModelsLoaded} onComplete={async () => { await syncWithFirebase(); setView('monitor'); }} />}
          {view === 'search' && <SearchView />}
          {view === 'admin' && <AdminView onSync={syncWithFirebase} setSelectedImage={setSelectedImage} />}
        </main>

        {/* ZOOM FORENSE */}
        {selectedImage && (
          <div className="fixed inset-0 z-[9999] bg-black/95 backdrop-blur-xl flex items-center justify-center p-4" onClick={() => setSelectedImage(null)}>
            <div className="relative max-w-5xl w-full h-full flex flex-col items-center justify-center gap-6">
              <button className="absolute -top-12 right-0 text-white font-black">FECHAR [X]</button>
              <div className="w-full h-full rounded-[40px] overflow-hidden border-4 border-white/10 bg-zinc-900">
                <img src={selectedImage} className="w-full h-full object-contain" />
              </div>
            </div>
          </div>
        )}
      </div>
    </ErrorBoundary>
  );
}

// Sub-Componente de Cadastro
function RegisterView({ cameras, isModelsLoaded, onComplete }) {
  const [name, setName] = useState('');
  const [cargo, setCargo] = useState('');
  const [departamento, setDepartamento] = useState('');
  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const cameraRef = useRef(null);
  const [samples, setSamples] = useState([]); // descriptors capturados

  const captureSample = async () => {
    if (!isModelsLoaded) return alert('Modelos ainda não carregados.');
    const img = cameraRef.current;
    if (!img || !img.complete) return alert('Câmera IP não pronta. Verifique se configurou uma câmera no Monitor.');

    const detection = await faceapi
      .detectSingleFace(img, new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.6 }))
      .withFaceLandmarks()
      .withFaceDescriptor();

    if (!detection) return alert('Rosto não detectado. Ajuste a posição e tente novamente.');

    setSamples(prev => {
      const newArr = [...prev, Array.from(detection.descriptor)];
      return newArr.slice(-5); // mantém no máximo 5 amostras
    });
    setStatusMsg(`Amostra ${samples.length + 1} de 5 obtida`);
  };

  const handleRegister = async () => {
    if (!name || !cargo || !departamento) return alert('Todos os campos são obrigatórios (Nome, Cargo, Departamento)');
    if (samples.length < 5) return alert('Capture ao menos 5 amostras antes de registrar');

    setLoading(true);
    setStatusMsg('Processando e a verificar sobreposições...');
    try {
      // Média dos 5 descriptors para obter um descriptor robusto e confiável
      const avg = new Array(128).fill(0);
      samples.forEach(desc => desc.forEach((v, i) => (avg[i] += v / samples.length)));
      const avgFloat32 = new Float32Array(avg);

      // 1. Procurar se esta pessoa (rosto físico) já existe na base de dados
      const usersSnapshot = await getDocs(collection(db, 'users'));
      let oldDocId = null;
      let minDistance = 0.45; // Threshold estrito para garantir que é a mesma pessoa fisicamente

      usersSnapshot.forEach(userDoc => {
        const data = userDoc.data();
        if (data.descriptor) {
          const dist = faceapi.euclideanDistance(avgFloat32, new Float32Array(data.descriptor));
          if (dist < minDistance) {
            minDistance = dist;
            oldDocId = userDoc.id;
          }
        }
      });

      // 2. Se a pessoa já existir, eliminar o registo antigo para dar lugar ao novo (atualização limpa)
      if (oldDocId) {
        setStatusMsg('A atualizar o perfil existente...');
        await deleteDoc(doc(db, 'users', oldDocId));
      }

      // 3. Criar o novo registo com a foto de perfil incluída
      await addDoc(collection(db, 'users'), {
        name,
        cargo,
        departamento,
        descriptor: avg,
        profileImage: samples[0], // Guardar a foto para visualização admin
        createdAt: serverTimestamp()
      });

      setStatusMsg('✅ Perfil biométrico guardado e ativado!');
      setTimeout(onComplete, 1500);
    } catch (e) {
      console.error(e);
      alert('Falha ao salvar no Firebase: ' + e.message);
      setStatusMsg('⚠️ Falha ao registrar');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-xl mx-auto bg-white/5 border border-white/10 p-10 rounded-[40px] shadow-2xl">
      <h2 className="text-3xl font-black mb-2 tracking-tighter">Bio‑Registo Integrado</h2>
      <p className="text-zinc-500 mb-6 text-sm uppercase tracking-widest">
        Adicionar Privilégios Completos ao Sistema
      </p>

      <div className="space-y-4 mb-4">
        <input
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          className="w-full bg-black border border-white/10 rounded-2xl p-4 text-xl outline-none focus:border-blue-500 transition-all"
          placeholder="Nome Completo"
        />
        <div className="flex gap-4">
          <input
            type="text"
            value={cargo}
            onChange={e => setCargo(e.target.value)}
            className="w-1/2 bg-black border border-white/10 rounded-2xl p-4 text-lg outline-none focus:border-blue-500 transition-all"
            placeholder="Cargo (Ex: Diretor)"
          />
          <input
            type="text"
            value={departamento}
            onChange={e => setDepartamento(e.target.value)}
            className="w-1/2 bg-black border border-white/10 rounded-2xl p-4 text-lg outline-none focus:border-blue-500 transition-all"
            placeholder="Dep. (Ex: TI)"
          />
        </div>
      </div>

      <div className="rounded-3xl overflow-hidden mb-6 border border-white/10 relative">
        <div className="absolute top-2 left-2 bg-black/80 px-3 py-1 rounded-full text-xs text-amber-500 font-bold z-10">Usando Câmera 1</div>
        <img ref={cameraRef} src={cameras[0]?.url || ''} crossOrigin="anonymous" className="w-full h-64 object-cover border border-white/10" />
      </div>

      <button
        onClick={captureSample}
        disabled={loading}
        className="w-full mb-4 py-3 bg-gray-700 hover:bg-gray-600 rounded-xl text-white disabled:opacity-50 font-bold tracking-wider"
      >
        CAPTURAR AMOSTRA ({samples.length}/5)
      </button>

      <button
        onClick={handleRegister}
        disabled={loading || samples.length < 5}
        className={`w-full py-5 rounded-2xl font-black text-xl flex items-center justify-center gap-3 transition-all tracking-wider ${
          loading ? 'bg-gray-600' : 'bg-blue-600 hover:bg-blue-500'
        } active:scale-95`}
      >
        {loading ? <RefreshCw className="animate-spin" /> : 'AUTORIZAR SISTEMA'}
      </button>

      {statusMsg && <p className="mt-4 text-center text-sm font-bold">{statusMsg}</p>}
    </div>
  );
}

function SearchView() {
  const [matches, setMatches] = useState([]);
  const [recentCaptures, setRecentCaptures] = useState([]);
  const [dbCount, setDbCount] = useState(null);
  const [loading, setLoading] = useState(false);

  // Carregar capturas recentes (Sem filtros para garantir que apareça)
  useEffect(() => {
    // Buscar TUDO para o contador, mas apenas as 6 mais recentes para a mesa
    const q = query(collection(db, 'detect_history'), orderBy('timestamp', 'desc'), limit(6));
    const unsub = onSnapshot(collection(db, 'detect_history'), (fullSnap) => {
      setDbCount(fullSnap.size);
    });
    
    const unsubRecent = onSnapshot(q, (snap) => {
      const data = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setRecentCaptures(data);
    });

    return () => { unsub(); unsubRecent(); };
  }, []);

  const handleImageUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setLoading(true);
    setMatches([]);
    // setTargetName removido pois causava erro de execução

    try {
      const img = await faceapi.bufferToImage(file);
      // MOTOR DE ALTA PRECISÃO PARA BUSCA EM ARQUIVO (SSD MOBILENET)
      const detection = await faceapi.detectSingleFace(img, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5 }))
        .withFaceLandmarks()
        .withFaceDescriptor();
      
      if (!detection) {
        setLoading(false);
        return alert('⚠️ Sentinel não detetou nenhum rosto nesta foto. Tente uma imagem mais clara ou de frente.');
      }

      const snapshotHistory = await getDocs(collection(db, 'detect_history'));
      const snapshotUsers = await getDocs(collection(db, 'users'));
      
      let minDistance = 1.0;
      let historyScanned = snapshotHistory.size;
      let usersScanned = snapshotUsers.size;
      const foundMatches = [];

      // A) Varredura no Histórico
      snapshotHistory.docs.forEach(doc => {
        const data = doc.data();
        if (data.descriptor) {
          const dist = faceapi.euclideanDistance(detection.descriptor, new Float32Array(data.descriptor));
          if (dist < minDistance) minDistance = dist;
          if (dist < 0.30) { // NÍVEL BANCÁRIO (Ultra-Estrito)
            foundMatches.push({ id: doc.id, distance: dist, ...data, source: 'Histórico' });
          }
        }
      });

      // B) Varredura no Cadastro
      snapshotUsers.docs.forEach(doc => {
        const data = doc.data();
        if (data.descriptor) {
          const dist = faceapi.euclideanDistance(detection.descriptor, new Float32Array(data.descriptor));
          if (dist < minDistance) minDistance = dist;
          if (dist < 0.30) { 
            foundMatches.push({ 
              id: doc.id, 
              distance: dist, 
              ...data, 
              source: 'Cadastro', 
              status: `Membro: ${data.name}`, 
              imageUrl: data.profileImage || 'https://www.w3schools.com/howto/img_avatar.png' 
            });
          }
        }
      });

      setMatches(foundMatches);
      
      if (foundMatches.length === 0) {
        alert(`Relatório de Varredura Sentinel:\n- Analisados ${historyScanned} registos.\n- Analisados ${usersScanned} membros.\n- Menor distância encontrada: ${minDistance.toFixed(2)} (Necessário < 0.30)\n\nConclusão: Ninguém com identidade confirmada passou pelas câmeras.`);
      }
    } catch (e) {
      console.error('Busca Erro:', e);
      alert(`⚠️ Erro na Investigação: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      <div className="bg-white/5 p-12 rounded-[50px] border border-white/10 text-center shadow-2xl relative overflow-hidden group">
        <div className="absolute inset-0 bg-blue-600/5 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"></div>
        <div className="w-24 h-24 bg-blue-600/20 rounded-full flex items-center justify-center mx-auto mb-8 shadow-xl border border-blue-500/20">
          <Search className="text-blue-500" size={40}/>
        </div>
        <h3 className="text-3xl font-black mb-4 tracking-tighter uppercase">Investigação Forense: Olho de Deus</h3>
        <p className="text-zinc-500 text-md mb-6 max-w-2xl mx-auto">Carregue uma fotografia do alvo. O Sentinel irá varrer meses de registos para mapear cada segundo que esta pessoa passou pelas suas câmaras.</p>
        
        {dbCount !== null && (
          <div className="mb-8 inline-block bg-white/5 border border-white/10 px-6 py-2 rounded-2xl">
            <span className="text-zinc-400 text-xs uppercase tracking-widest font-bold">Arquivo de Inteligência: </span>
            <span className="text-blue-500 font-mono font-black">{dbCount} rostos capturados</span>
          </div>
        )}
        
        <div className="block">
          <label className="bg-blue-600 hover:bg-blue-500 text-white px-12 py-5 rounded-3xl font-black cursor-pointer transition-all inline-flex items-center gap-4 shadow-xl shadow-blue-600/30 active:scale-95 text-lg uppercase tracking-widest">
            <Upload size={24}/> SELECIONAR ALVO
            <input type="file" className="hidden" onChange={handleImageUpload} />
          </label>
        </div>
      </div>

      {loading && (
        <div className="flex flex-col items-center justify-center py-20 gap-4">
          <Loader2 className="animate-spin text-blue-500" size={64}/>
          <p className="text-blue-400 font-black tracking-widest animate-pulse uppercase">Varendo Base de Dados Global...</p>
        </div>
      )}

      {matches.length > 0 && (
        <div className="space-y-10 fade-in">
          <div className="flex items-center gap-4 border-l-4 border-blue-500 pl-6">
             <h4 className="text-3xl font-black uppercase tracking-tighter text-white">Resultados da Varredura ({matches.length})</h4>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {matches.map((m, idx) => (
              <div key={m.id} className="bg-[#111115] border border-white/5 rounded-[35px] overflow-hidden group hover:border-blue-500/50 transition-all shadow-2xl relative">
                <div className="absolute top-4 left-4 z-10 bg-blue-600 text-white px-4 py-1 rounded-full text-[10px] font-black tracking-widest">
                  AVISTAMENTO #{matches.length - idx}
                </div>
                <div className="aspect-square relative overflow-hidden">
                  <img src={m.imageUrl} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700" />
                  <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-transparent opacity-80"></div>
                </div>
                <div className="p-8">
                  <div className="flex justify-between items-start mb-6">
                    <div>
                      <p className="text-[10px] text-zinc-500 uppercase font-black tracking-widest mb-1">Localização</p>
                      <h5 className="text-xl font-bold text-white uppercase tracking-tight flex items-center gap-2">
                        <Camera size={18} className="text-blue-500"/> CÂMARA {m.camId || '1'}
                      </h5>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] text-zinc-500 uppercase font-black tracking-widest mb-1">Precisão</p>
                      <span className="text-blue-400 font-mono font-black text-lg">{( (1 - m.distance) * 100).toFixed(0)}%</span>
                    </div>
                  </div>
                  
                  <div className="bg-white/5 p-4 rounded-2xl border border-white/5 mb-4">
                    <p className="text-[10px] text-zinc-500 uppercase font-black tracking-widest mb-1 italic">Momento Exato</p>
                    <p className="text-md font-mono text-zinc-200">
                      {m.timestamp ? (
                        typeof m.timestamp.toDate === 'function' 
                          ? m.timestamp.toDate().toLocaleString() 
                          : new Date(m.timestamp).toLocaleString()
                      ) : 'Data Indisponível'}
                    </p>
                  </div>
                  
                  <div className={`text-center py-2 rounded-xl text-[10px] font-black tracking-[0.2em] uppercase ${m.status === 'Ameaça Hostil' ? 'bg-red-500/20 text-red-500' : 'bg-amber-500/20 text-amber-500'}`}>
                    {m.status || 'Alvo Identificado'}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* GALERIA DE EVIDÊNCIAS RECENTES (PROVA DOS NOVE) */}
      <div className="mt-20 pt-10 border-t border-white/5">
        <h4 className="text-xl font-bold mb-6 flex items-center gap-2 uppercase tracking-widest text-zinc-400">
          <History size={20} className="text-blue-500"/> Mesa de Evidências: Capturas Recentes
        </h4>
        {recentCaptures.length === 0 ? (
          <div className="bg-white/5 p-12 rounded-3xl border border-dashed border-white/10 text-center">
            <p className="text-zinc-500 font-mono italic">O Arquivo de Inteligência está vazio. Arme o sistema e passe na câmera.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            {recentCaptures.map((cap) => (
              <div key={cap.id} className="relative group rounded-2xl overflow-hidden border border-white/10 bg-zinc-900 shadow-2xl">
                <img src={cap.imageUrl} className="w-full h-32 object-cover opacity-80 group-hover:opacity-100 transition-all" alt="Sighting"/>
                <div className="p-3">
                  <p className="text-[10px] font-black uppercase text-blue-500 truncate">{cap.status || 'Captura'}</p>
                  <p className="text-[9px] text-zinc-500 font-mono">
                    CAM {cap.camId} | {cap.timestamp ? (
                      typeof cap.timestamp.toDate === 'function' 
                        ? cap.timestamp.toDate().toLocaleTimeString() 
                        : new Date(cap.timestamp).toLocaleTimeString()
                    ) : '--:--'}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// Sub-Componente de Gestão de Administradores
function AdminView({ onSync, setSelectedImage }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);

  const testDatabase = async () => {
    try {
      await addDoc(collection(db, 'detect_history'), {
        status: 'TESTE DE CONEXÃO',
        timestamp: serverTimestamp(),
        label: 'TESTE GOGOMA'
      });
      alert('✅ CONEXÃO COM BANCO DE DADOS: OK! O Sentinel consegue salvar arquivos.');
    } catch(e) {
      alert(`❌ FALHA NA CONEXÃO: ${e.message}`);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const q = query(collection(db, 'users'), orderBy('createdAt', 'desc'));
      const snapshot = await getDocs(q);
      setUsers(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id, name) => {
    if (!window.confirm(`TEM A CERTEZA QUE DESEJA REVOGAR O ACESSO DE:\n${name}?\n\nEsta ação irá apagar os registos biométricos permanentemente. Se esta pessoa passar na câmara, soará o alarme de invasão.`)) return;
    
    try {
      await deleteDoc(doc(db, 'users', id));
      setUsers(users.filter(u => u.id !== id));
      if (onSync) await onSync(); // Atualiza a RAM da IA para esquecer esta cara instantaneamente
      alert(`Acesso revogado com sucesso. A Inteligência Artificial já não o reconhece.`);
    } catch(e) {
      alert("Erro ao revogar acesso: " + e.message);
    }
  };

  return (
    <div className="max-w-5xl mx-auto bg-white/5 border border-white/10 p-10 rounded-[40px] shadow-2xl">
      <h2 className="text-3xl font-black mb-2 tracking-tighter flex items-center gap-3"><Settings className="text-blue-500"/> Gestão de Acessos</h2>
      <p className="text-zinc-500 mb-8 text-sm uppercase tracking-widest">
        Administrar, Revogar e Suspender Perfis Biométricos
      </p>

      {loading ? (
        <div className="flex justify-center p-10"><Loader2 className="animate-spin text-blue-500" size={48}/></div>
      ) : users.length === 0 ? (
        <p className="text-zinc-500 text-center py-10 font-bold">Nenhum membro ativo registado no sistema.</p>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {users.map(user => (
            <div key={user.id} className="bg-black/50 border border-white/10 p-6 rounded-3xl flex flex-col md:flex-row justify-between items-center group hover:border-white/20 transition-all gap-4">
              <div className="flex items-center gap-6 w-full md:w-auto">
                <div 
                  className="w-16 h-16 rounded-2xl overflow-hidden border-2 border-white/10 cursor-zoom-in hover:border-blue-500 shrink-0"
                  onClick={() => user.profileImage && setSelectedImage(user.profileImage)}
                >
                  {user.profileImage ? (
                    <img src={user.profileImage} className="w-full h-full object-cover" alt="Perfil" />
                  ) : (
                    <div className="w-full h-full bg-blue-500/10 flex items-center justify-center">
                      <Shield size={24} className="text-blue-500"/>
                    </div>
                  )}
                </div>
                <div className="flex-1">
                  <h4 className="text-2xl font-black uppercase text-white tracking-tighter">{user.name}</h4>
                  <p className="text-blue-400 font-bold text-sm tracking-widest uppercase">{user.cargo} <span className="text-zinc-600 mx-2">|</span> <span className="text-zinc-400">{user.departamento}</span></p>
                  <p className="text-zinc-600 text-[10px] mt-2 font-mono uppercase">
                    Registado em: {user.createdAt ? (
                      typeof user.createdAt.toDate === 'function' 
                        ? user.createdAt.toDate().toLocaleDateString() 
                        : new Date(user.createdAt).toLocaleDateString()
                    ) : 'Desconhecido'}
                  </p>
                </div>
              </div>
              <button 
                onClick={() => handleDelete(user.id, user.name)}
                className="bg-red-500/10 border border-red-500/20 hover:border-red-500 hover:bg-red-500 text-red-500 hover:text-white px-6 py-4 rounded-2xl font-black tracking-widest transition-all flex items-center gap-3 w-full md:w-auto justify-center"
              >
                <Trash2 size={20}/>
                <span>REVOGAR ACESSO</span>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
