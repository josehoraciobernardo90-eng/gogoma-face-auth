import React, { useState, useRef, useEffect } from 'react';
import Webcam from 'react-webcam';
import * as faceapi from 'face-api.js';
import { db, storage } from './firebase';
import { collection, addDoc, getDocs, query, orderBy, limit, serverTimestamp, deleteDoc, doc, onSnapshot } from 'firebase/firestore';
import { ref, uploadString, getDownloadURL } from 'firebase/storage';
import { Camera, Users, History, CheckCircle, AlertCircle, Loader2, UserPlus, Shield, Search, Upload, RefreshCw, Trash2, Settings } from 'lucide-react';

export default function GogomaSentinelFirebase() {
  const [view, setView] = useState('monitor');
  const [isModelsLoaded, setIsModelsLoaded] = useState(false);
  const [status, setStatus] = useState('Standby');
  const [faceMatcher, setFaceMatcher] = useState(null);
  const [identifiedName, setIdentifiedName] = useState('Desconhecido');
  const [logs, setLogs] = useState([]);
  
  const webcamRef = useRef(null);
  const canvasRef = useRef(null);

  // 0. Listener para Logs em Tempo Real (Painel Lateral Firebase)
  useEffect(() => {
    const q = query(collection(db, 'detect_history'), orderBy('timestamp', 'desc'), limit(20));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const logsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setLogs(logsData);
    });
    return () => unsubscribe();
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

  // 1. Carregar Modelos Pesados para Precisão (SSD, Recognition e Expressions)
  useEffect(() => {
    const loadIA = async () => {
      const MODEL_URL = 'https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights';
      try {
        setStatus('Calibrando Redes Neurais...');
        await Promise.all([
          faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL),
          faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
          faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
          faceapi.nets.faceExpressionNet.loadFromUri(MODEL_URL) // Necessário para Anti-Spoofing
        ]);
        setIsModelsLoaded(true);
        window.isModelsLoaded = true; // global flag
        setStatus('Sentinel Ativo');
        await syncWithFirebase();
        setIsModelsLoaded(true);
        // tornar disponível globalmente para o RegisterView
        window.isModelsLoaded = true;
        setStatus('Sentinel Ativo');
        await syncWithFirebase();
      } catch (e) { console.error(e); setStatus('Erro IA'); }
    };
    loadIA();
  }, []);

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
        setFaceMatcher(new faceapi.FaceMatcher(labeledDescriptors, 0.48)); // Tolerância ajustada para 0.48: Estabiliza contra movimentos sem causar falsos positivos
      } else {
        setFaceMatcher(null); // ESQUECER TODOS! (Base de dados vazia)
      }
    } catch (e) { 
      console.warn('Sem usuarios no Firebase ainda.'); 
      setFaceMatcher(null);
    }
  };

  // 3. Loop de Detecção em Tempo Real com Desenho no Canvas
  useEffect(() => {
    let interval;
    if (isModelsLoaded && view === 'monitor') {
      interval = setInterval(async () => {
        if (webcamRef.current && webcamRef.current.video.readyState === 4) {
          const video = webcamRef.current.video;
          const { videoWidth, videoHeight } = video;
          
          canvasRef.current.width = videoWidth;
          canvasRef.current.height = videoHeight;

          try {
            const ctx = canvasRef.current.getContext('2d');
            
            // 🛑 MODO RESIDENCIAL: A câmara inteira é a zona de proteção.
            ctx.fillStyle = 'rgba(59, 130, 246, 0.8)';
            ctx.font = 'bold 12px Inter';
            ctx.fillText('VIGILÂNCIA RESIDENCIAL ATIVA (FOV TOTAL)', 15, 25);

            // Ajustar o threshold para 0.55 para detetar APENAS rostos humanos reais (ignorar cães e sombras)
            const detections = await faceapi.detectAllFaces(video, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.55 }))
              .withFaceLandmarks()
              .withFaceDescriptors();

            if (detections.length > 0) {
              const dims = faceapi.matchDimensions(canvasRef.current, video, true);
              const resizedDetections = faceapi.resizeResults(detections, dims);
              let detectedNames = [];

              resizedDetections.forEach(resized => {
                let label = 'Desconhecido';
                let displayName = 'ALVO DESCONHECIDO';
                let displayExtra = '';
                let isSuspeito = false;
                let isRecognized = false;
                
                const box = resized.detection.box;
                
                // 1. Biometria
                if (faceMatcher && resized.descriptor) {
                  const match = faceMatcher.findBestMatch(resized.descriptor);
                  const matchLabel = match.label;
                  
                  if (matchLabel !== 'unknown') {
                    try {
                      const userData = JSON.parse(matchLabel);
                      label = userData.name;
                      displayName = `AUTORIZADO: ${userData.name}`;
                      displayExtra = `Residente / Família`;
                    } catch(e) {
                      label = matchLabel;
                      displayName = `AUTORIZADO: ${label}`;
                    }
                    isRecognized = true;
                    // Marca a presença de alguém autorizado na casa (silencia falsos positivos por 1 minuto)
                    window.lastAuthorizedTime = Date.now();
                  }
                }
                
                // 2. Suspeito/Desconhecido (Qualquer pessoa não registada na casa)
                if (!isRecognized) {
                  const ownerWasJustHere = window.lastAuthorizedTime && (Date.now() - window.lastAuthorizedTime < 60000);
                  
                  if (ownerWasJustHere) {
                    label = 'Familiar'; // Ignora a ameaça porque o dono acabou de ser visto
                    displayName = 'FAMILIAR (VISTO RECENTEMENTE)';
                    isSuspeito = false;
                  } else if (resized.detection.score < 0.6) {
                    label = 'Suspeito';
                    displayName = 'ALVO SUSPEITO (ROSTO OCULTO)';
                    isSuspeito = true;
                  } else {
                    label = 'Desconhecido';
                    displayName = 'INVASÃO RESIDENCIAL DETETADA';
                  }
                }
                
                detectedNames.push(label);

                // Desenhar Rosto
                if (isSuspeito) {
                  ctx.strokeStyle = '#f59e0b';
                  ctx.fillStyle = '#f59e0b';
                } else {
                  ctx.strokeStyle = label === 'Desconhecido' ? '#dc2626' : '#3b82f6';
                  ctx.fillStyle = label === 'Desconhecido' ? '#dc2626' : '#3b82f6';
                }
                ctx.lineWidth = label === 'Desconhecido' ? 6 : 4;
                ctx.strokeRect(box.x, box.y, box.width, box.height);
                
                ctx.font = 'bold 18px Inter';
                ctx.fillText(displayName, box.x, box.y - 10);
                
                if (displayExtra) {
                  ctx.font = 'bold 14px Inter';
                  ctx.fillStyle = '#60a5fa';
                  ctx.fillText(displayExtra, box.x, box.y + box.height + 25);
                }

                // Disparar protocolo: Qualquer rosto desconhecido detetado no ecrã
                if (label === 'Desconhecido' || isSuspeito) {
                  // Só dispara se o sistema de alarme estiver ligado (ARMADO)
                  if (window.isArmed !== false) {
                    if (!window.lastSaveTime || Date.now() - window.lastSaveTime > 180000) { // 3 MINUTOS de Cooldown
                      saveUnknownToHistory(resized, webcamRef.current.getScreenshot(), isSuspeito ? 'Alvo Suspeito' : 'Invasão Residencial');
                      window.lastSaveTime = Date.now();
                    }
                  } else {
                    // Sistema desarmado: Apenas desenha no ecrã, não manda foto
                    ctx.fillStyle = '#f59e0b';
                    ctx.font = 'bold 12px Inter';
                    ctx.fillText('SISTEMA DESARMADO (ALERTA CANCELADO)', box.x, box.y + box.height + 45);
                  }
                }
              });
              setIdentifiedName(detectedNames.join(', '));
            } else {
              setIdentifiedName('');
            }
          } catch(e) {
            console.error("Erro na deteção:", e);
            setIdentifiedName("FALHA NA CÂMARA (VERIFIQUE A LUZ)");
          }
        }
      }, 200);
    }
    return () => clearInterval(interval);
  }, [isModelsLoaded, view, faceMatcher]);

  // 4. Protocolo de Segurança: Enviar Alerta + Salvar Histórico (Desacoplado)
  const saveUnknownToHistory = async (detection, image, statusClass = 'Desconhecido') => {
    // 1. PRIORIDADE ABSOLUTA MILITAR: Disparar Telegram Imediatamente (Sem depender do Firebase)
    try {
      sendTelegramAlert(image, `Ameaça de Nível Crítico Registada:\nEstado: *${statusClass.toUpperCase()}*`);
    } catch(e) { console.error('Erro Telegram:', e); }

    // 2. BACKUP HISTÓRICO: Tentar guardar na Cloud da Firebase (Se falhar, não afeta o Telegram)
    try {
      const fileName = `${statusClass === 'Desconhecido' ? 'unknown' : 'suspect'}_${Date.now()}.jpg`;
      const storageRef = ref(storage, `detect_history/${fileName}`);
      await uploadString(storageRef, image, 'data_url');
      const url = await getDownloadURL(storageRef);

      await addDoc(collection(db, 'detect_history'), {
        descriptor: Array.from(detection.descriptor),
        imageUrl: url,
        timestamp: serverTimestamp(),
        status: statusClass
      });
      console.log(`Sentinel: ${statusClass} registado no Firebase Storage.`);
    } catch (e) { 
      console.warn('Aviso: Foto enviada para o Telegram, mas o Firebase Storage está sem espaço ou bloqueado.', e.message);
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0c] text-zinc-100 font-sans p-6 overflow-hidden flex flex-col">
      {/* Header Profissional */}
      <header className="flex justify-between items-center mb-8 border-b border-white/5 pb-4">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-blue-600/20 rounded-xl flex items-center justify-center border border-blue-500/40">
            <Shield className="text-blue-500" size={28} />
          </div>
          <div>
            <h1 className="text-2xl font-black tracking-tighter flex items-center gap-2">
              GOGOMA <span className="text-blue-500 italic">SENTINEL v3</span>
              <span className="text-[10px] bg-blue-500 text-white px-2 py-0.5 rounded-full uppercase">Firebase Live</span>
            </h1>
            <p className="text-xs text-zinc-500 font-mono">COMMAND CENTER | CHIMOIO HUB</p>
          </div>
        </div>
        
        <nav className="flex items-center gap-3">
          {/* BOTÃO DE ARMAR/DESARMAR ALARME */}
          <button 
            onClick={() => { window.isArmed = window.isArmed === false ? true : false; setStatus(window.isArmed ? 'Armado' : 'Desarmado'); }}
            className={`px-4 py-2 rounded-xl text-sm font-black transition-all flex items-center gap-2 shadow-lg border ${window.isArmed !== false ? 'bg-red-600 text-white border-red-500 animate-pulse' : 'bg-zinc-800 text-zinc-400 border-zinc-700'}`}>
            <Shield size={16} />
            {window.isArmed !== false ? 'SISTEMA ARMADO' : 'SISTEMA DESARMADO'}
          </button>

          <div className="flex bg-white/5 p-1 rounded-xl border border-white/5">
            <button onClick={() => setView('monitor')} className={`px-4 py-2 rounded-lg text-sm font-bold transition-all flex items-center gap-2 ${view === 'monitor' ? 'bg-blue-600 text-white shadow-lg' : 'text-zinc-400 hover:text-zinc-200'}`}><Camera size={16}/> Monitor</button>
            <button onClick={() => setView('register')} className={`px-4 py-2 rounded-lg text-sm font-bold transition-all flex items-center gap-2 ${view === 'register' ? 'bg-blue-600 text-white shadow-lg' : 'text-zinc-400 hover:text-zinc-200'}`}><UserPlus size={16}/> Cadastro</button>
            <button onClick={() => setView('search')} className={`px-4 py-2 rounded-lg text-sm font-bold transition-all flex items-center gap-2 ${view === 'search' ? 'bg-blue-600 text-white shadow-lg' : 'text-zinc-400 hover:text-zinc-200'}`}><Search size={16}/> Busca Histórica</button>
            <button onClick={() => setView('admin')} className={`px-4 py-2 rounded-lg text-sm font-bold transition-all flex items-center gap-2 ${view === 'admin' ? 'bg-blue-600 text-white shadow-lg' : 'text-zinc-400 hover:text-zinc-200'}`}><Settings size={16}/> Gestão de Membros</button>
          </div>
        </nav>
      </header>

      {/* Main View */}
      <main className="flex-1">
        {view === 'monitor' && (
          <div className="grid grid-cols-12 gap-8 h-full">
            <div className="col-span-9 relative group">
              <div className="absolute inset-0 bg-blue-500/5 blur-3xl opacity-0 group-hover:opacity-100 transition-opacity"></div>
              <div className="relative rounded-3xl overflow-hidden border-2 border-white/10 shadow-2xl bg-black">
                <Webcam ref={webcamRef} audio={false} className="w-full h-[600px] object-cover opacity-80" screenshotFormat="image/jpeg" videoConstraints={{ width: 1920, height: 1080, facingMode: "user" }} />
                <canvas ref={canvasRef} className="absolute inset-0 pointer-events-none" />
                <div className="absolute bottom-8 left-8 flex gap-4">
                  <div className="glass-card px-6 py-3 rounded-2xl flex items-center gap-4">
                    <div className={`w-3 h-3 rounded-full ${identifiedName.includes('Desconhecido') ? 'bg-red-500 animate-pulse' : (identifiedName.includes('Suspeito') ? 'bg-amber-500 animate-bounce' : (identifiedName ? 'bg-blue-500 pulse-blue' : 'bg-gray-500'))}`}></div>
                    <div>
                      <p className="text-[10px] uppercase font-black text-zinc-500 tracking-widest">Alvos Detectados</p>
                      <p className={`text-xl font-mono font-bold ${identifiedName.includes('Desconhecido') ? 'text-red-500' : (identifiedName.includes('Suspeito') ? 'text-amber-500' : 'text-blue-500')}`}>{identifiedName ? identifiedName.toUpperCase() : 'NENHUM ALVO'}</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div className="col-span-3 flex flex-col gap-4">
               <div className="bg-white/5 border border-white/5 rounded-3xl p-6 flex-1 flex flex-col overflow-hidden">
                  <h3 className="text-sm font-black uppercase text-zinc-500 mb-4 flex items-center gap-2"><History size={16}/> Logs Firebase</h3>
                  <div className="flex-1 overflow-y-auto space-y-4 pr-2">
                    {logs.length === 0 ? (
                      <p className="text-zinc-600 italic text-xs">Monitoramento ativo. Aguardando eventos...</p>
                    ) : (
                      logs.map(log => (
                        <div key={log.id} className="flex gap-3 bg-black/50 p-3 rounded-2xl border border-white/5 items-center">
                          <img src={log.imageUrl} alt="Log" className="w-12 h-12 rounded-xl object-cover border border-white/10" />
                          <div className="flex-1">
                            <p className={`text-xs font-bold ${log.status === 'Oculto/Suspeito' ? 'text-amber-500' : 'text-red-500'}`}>
                              {log.status.toUpperCase()}
                            </p>
                            <p className="text-[10px] text-zinc-500">
                              {log.timestamp ? new Date(log.timestamp.toDate()).toLocaleString() : 'A sincronizar...'}
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

        {view === 'register' && <RegisterView onComplete={async () => { await syncWithFirebase(); setView('monitor'); }} />}
        {view === 'search' && <SearchView />}
        {view === 'admin' && <AdminView onSync={syncWithFirebase} />}
      </main>
    </div>
  );
}

// Sub-Componente de Cadastro
function RegisterView({ onComplete }) {
  const [name, setName] = useState('');
  const [cargo, setCargo] = useState('');
  const [departamento, setDepartamento] = useState('');
  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const webcamRef = useRef(null);
  const [samples, setSamples] = useState([]); // descriptors capturados

  const captureSample = async () => {
    if (!window.isModelsLoaded) return alert('Modelos ainda não carregados.');
    const video = webcamRef.current?.video;
    if (!video || video.readyState !== 4) return alert('Câmera não pronta.');

    const detection = await faceapi
      .detectSingleFace(video, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.6 }))
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

      // 3. Criar o novo registo com os dados corrigidos/novos
      await addDoc(collection(db, 'users'), {
        name,
        cargo,
        departamento,
        descriptor: avg,
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

      <div className="rounded-3xl overflow-hidden mb-6 border border-white/10">
        <Webcam ref={webcamRef} audio={false} className="w-full h-64 object-cover" />
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
  const [match, setMatch] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleImageUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setLoading(true);
    try {
      const img = await faceapi.bufferToImage(file);
      const detection = await faceapi.detectSingleFace(img).withFaceLandmarks().withFaceDescriptor();
      
      if (!detection) throw new Error('Nenhum rosto na foto carregada.');

      // 1. Procurar na base de Autorizados (users)
      const qUsers = query(collection(db, 'users'));
      const snapshotUsers = await getDocs(qUsers);
      
      let bestDist = 1;
      let bestMatchData = null;

      snapshotUsers.docs.forEach(doc => {
        const data = doc.data();
        if (data.descriptor) {
          const dist = faceapi.euclideanDistance(detection.descriptor, new Float32Array(data.descriptor));
          if (dist < bestDist) {
            bestDist = dist;
            bestMatchData = data;
          }
        }
      });

      if (bestDist <= 0.48) {
        setMatch({ type: 'registered', data: bestMatchData, confidence: 1 - bestDist });
        setLoading(false);
        return; // Sai se encontrou
      }

      // 2. Se não é funcionário, procurar no Histórico de Suspeitos (detect_history)
      bestDist = 1;
      bestMatchData = null;
      const qHistory = query(collection(db, 'detect_history'));
      const snapshotHistory = await getDocs(qHistory);
      
      snapshotHistory.docs.forEach(doc => {
        const data = doc.data();
        if (data.descriptor) {
          const dist = faceapi.euclideanDistance(detection.descriptor, new Float32Array(data.descriptor));
          if (dist < bestDist) {
            bestDist = dist;
            bestMatchData = data;
          }
        }
      });

      if (bestDist < 0.6) {
        setMatch({ type: 'history', data: bestMatchData, confidence: 1 - bestDist });
      } else {
        alert('Nenhum registo encontrado para este rosto na base de dados do Sentinel.');
      }
      
    } catch (e) { alert(e.message); }
    finally { setLoading(false); }
  };

  return (
    <div className="max-w-4xl mx-auto grid grid-cols-2 gap-8">
      <div className="bg-white/5 p-10 rounded-[40px] border border-white/10 text-center">
        <div className="w-20 h-20 bg-blue-600/20 rounded-full flex items-center justify-center mx-auto mb-6"><Upload className="text-blue-500" size={32}/></div>
        <h3 className="text-xl font-bold mb-4">Investigação Forense</h3>
        <p className="text-zinc-500 text-sm mb-8">Carregue uma imagem para comparar com todos os rostos capturados pelo Sentinel no passado.</p>
        <label className="bg-blue-600 hover:bg-blue-500 px-8 py-4 rounded-2xl font-bold cursor-pointer transition-all inline-block">
          SELECIONAR FOTO
          <input type="file" className="hidden" onChange={handleImageUpload} />
        </label>
      </div>

      <div className="bg-white/5 p-10 rounded-[40px] border border-white/10 flex flex-col items-center justify-center">
        {loading ? <Loader2 className="animate-spin text-blue-500" size={48}/> : match ? (
          <div className="w-full text-center fade-in">
            {match.type === 'registered' ? (
              <>
                <div className="w-48 h-48 rounded-3xl bg-blue-500/10 mx-auto mb-6 flex flex-col items-center justify-center border-4 border-blue-500 shadow-[0_0_50px_rgba(59,130,246,0.3)]">
                   <Shield size={64} className="text-blue-500 mb-2"/>
                   <span className="font-bold text-blue-500 tracking-widest text-sm">PERFIL SEGURO</span>
                </div>
                <h4 className="text-3xl font-black text-blue-400 uppercase tracking-tighter">{match.data.name}</h4>
                <p className="text-zinc-400 text-md mt-2 font-bold">{match.data.cargo} <span className="text-zinc-600">|</span> {match.data.departamento}</p>
                <div className="mt-6 inline-block bg-blue-500/20 px-6 py-2 rounded-full border border-blue-500/50">
                  <span className="text-blue-400 font-bold tracking-widest text-xs">ACESSO AUTORIZADO</span>
                </div>
              </>
            ) : (
              <>
                <img src={match.data.imageUrl} className={`w-48 h-48 rounded-3xl object-cover mx-auto mb-6 border-4 shadow-2xl ${match.data.status === 'Oculto/Suspeito' ? 'border-amber-500 shadow-[0_0_50px_rgba(245,158,11,0.3)]' : 'border-red-500 shadow-[0_0_50px_rgba(239,68,68,0.3)]'}`} />
                <h4 className={`text-2xl font-black uppercase tracking-tighter ${match.data.status === 'Oculto/Suspeito' ? 'text-amber-500' : 'text-red-500'}`}>
                  ALVO {match.data.status === 'Oculto/Suspeito' ? 'SUSPEITO' : 'DESCONHECIDO'}
                </h4>
                <p className="text-zinc-400 text-sm mt-2">Detetado em: <span className="text-white font-mono">{match.data.timestamp ? new Date(match.data.timestamp.toDate()).toLocaleString() : 'Desconhecido'}</span></p>
                <div className={`mt-6 inline-block px-6 py-2 rounded-full border ${match.data.status === 'Oculto/Suspeito' ? 'bg-amber-500/20 border-amber-500/50' : 'bg-red-500/20 border-red-500/50'}`}>
                  <span className={`font-bold tracking-widest text-xs ${match.data.status === 'Oculto/Suspeito' ? 'text-amber-400' : 'text-red-400'}`}>REGISTO DE INTRUSÃO</span>
                </div>
              </>
            )}
            <p className="text-zinc-600 font-mono text-[10px] mt-8 uppercase tracking-widest">Precisão Biométrica: {(match.confidence * 100).toFixed(2)}%</p>
          </div>
        ) : <p className="text-zinc-600 italic">Aguardando foto para análise forense...</p>}
      </div>
    </div>
  );
}

// Sub-Componente de Gestão de Administradores
function AdminView({ onSync }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);

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
                <div className="w-16 h-16 bg-blue-500/10 rounded-2xl flex items-center justify-center border border-blue-500/30 shrink-0">
                  <Shield size={24} className="text-blue-500"/>
                </div>
                <div className="flex-1">
                  <h4 className="text-2xl font-black uppercase text-white tracking-tighter">{user.name}</h4>
                  <p className="text-blue-400 font-bold text-sm tracking-widest uppercase">{user.cargo} <span className="text-zinc-600 mx-2">|</span> <span className="text-zinc-400">{user.departamento}</span></p>
                  <p className="text-zinc-600 text-[10px] mt-2 font-mono uppercase">Registado em: {user.createdAt ? new Date(user.createdAt.toDate()).toLocaleDateString() : 'Desconhecido'}</p>
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
