// --- DOM Elements ---
const btnStart = document.getElementById('btn-start');
const btnPause = document.getElementById('btn-pause');
const btnReset = document.getElementById('btn-reset');
const btnDeleteSelected = document.getElementById('btn-delete-selected');
const algoSelect = document.getElementById('algo-select');

const simArea = document.getElementById('sim-area');
const logArea = document.getElementById('log-area');
const speedSlider = document.getElementById('sim-speed');
const windowSizeInput = document.getElementById('window-size');
const senderInfo = document.getElementById('sender-info');
const receiverInfo = document.getElementById('receiver-info');
const senderWindowVisual = document.getElementById('sender-window-visual');
const receiverLogDiv = document.getElementById('receiver-log');
const receiverBufferDiv = document.getElementById('receiver-buffer-display');

// --- Protocol & Simulation State ---
let simInterval;
let isRunning = false;
let isPaused = false;
let timeScale = 5; 
let WINDOW_SIZE = 4;
let currentAlgorithm = 'gbn';

// --- State Variables ---
let sendBase = 1;
let nextSeqNum = 1;
let packetBuffer = {}; // { seqNum: { element, status: 'sent'/'acked' } }
let selectedElement = null; // NEW: { type, seqNum, element }

// --- GBN Timer ---
let gbnTimer = null; // { timerId, startTime, remaining, seqNum }

// --- SR State ---
let srPacketTimers = {}; // { seqNum: { timerId, startTime, remaining } }
let rcvBase = 1;
let rcvBuffer = {}; // { seqNum: true (for buffered) }

// --- Event Listeners ---
btnStart.onclick = startSim;
btnPause.onclick = pauseSim;
btnReset.onclick = resetSim;
btnDeleteSelected.onclick = deleteSelected; // UPDATED

speedSlider.oninput = (e) => {
    timeScale = e.target.value;
    document.querySelectorAll('.packet, .ack').forEach(p => {
        if (p.style.animationPlayState !== 'paused') {
            p.style.animationDuration = `${timeScale}s`;
        }
    });
};
windowSizeInput.onchange = (e) => {
    WINDOW_SIZE = parseInt(e.target.value, 10);
    if (!isRunning) updateUI();
};
algoSelect.onchange = (e) => {
    currentAlgorithm = e.target.value;
    if (!isRunning) resetSim();
};

// --- Logging Function ---
function log(message, type = 'network') {
    const entry = document.createElement('div');
    entry.className = type;
    entry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
    logArea.appendChild(entry);
    logArea.scrollTop = logArea.scrollHeight; 
}

// --- Timer Control Functions ---
function getTimeoutDuration() {
    const rtt = parseFloat(speedSlider.value) * 1000 * 2;
    return rtt + 2000; // RTT + 2 second buffer
}

function startGBNTimer() {
    clearGBNTimer(); 
    const timeoutDuration = getTimeoutDuration();
    gbnTimer = {
        timerId: setTimeout(onPacketTimeout, timeoutDuration),
        startTime: Date.now(),
        remaining: timeoutDuration,
        seqNum: sendBase 
    };
    log(`SENDER (GBN): Timer started for Packet ${sendBase} (${(timeoutDuration/1000).toFixed(1)}s)`, 'sender');
}
function clearGBNTimer() {
    if (gbnTimer) {
        clearTimeout(gbnTimer.timerId);
        gbnTimer = null;
    }
}
function pauseGBNTimer() {
    if (gbnTimer) {
        clearTimeout(gbnTimer.timerId);
        gbnTimer.remaining -= (Date.now() - gbnTimer.startTime);
    }
}
function resumeGBNTimer() {
    if (gbnTimer) {
        if (gbnTimer.remaining <= 0) { onPacketTimeout(); } 
        else {
            gbnTimer.startTime = Date.now();
            gbnTimer.timerId = setTimeout(onPacketTimeout, gbnTimer.remaining);
        }
    }
}

function startSRTimer(seqNum) {
    clearSRTimer(seqNum);
    const timeoutDuration = getTimeoutDuration();
    srPacketTimers[seqNum] = {
        timerId: setTimeout(() => onPacketTimeout(seqNum), timeoutDuration),
        startTime: Date.now(),
        remaining: timeoutDuration
    };
    log(`SENDER (SR): Timer started for P ${seqNum} (${(timeoutDuration/1000).toFixed(1)}s)`, 'sender');
}
function clearSRTimer(seqNum) {
    if (srPacketTimers[seqNum]) {
        clearTimeout(srPacketTimers[seqNum].timerId);
        delete srPacketTimers[seqNum];
    }
}
function pauseAllSRTimers() {
    for (const seqNum in srPacketTimers) {
        const timer = srPacketTimers[seqNum];
        clearTimeout(timer.timerId);
        timer.remaining -= (Date.now() - timer.startTime);
    }
}
function resumeAllSRTimers() {
    for (const seqNum in srPacketTimers) {
        const timer = srPacketTimers[seqNum];
        if (timer.remaining <= 0) {
            onPacketTimeout(parseInt(seqNum));
        } else {
            timer.startTime = Date.now();
            timer.timerId = setTimeout(() => onPacketTimeout(parseInt(seqNum)), timer.remaining);
        }
    }
}

// --- Core Simulation Functions ---
function startSim() {
    if (isRunning) return;
    isRunning = true;
    isPaused = false;
    btnStart.disabled = true;
    algoSelect.disabled = true;
    btnPause.textContent = '⏸ Pause';
    btnPause.disabled = false;
    log(`Simulation Started (${currentAlgorithm.toUpperCase()})`, 'network');
    simInterval = setInterval(mainLoop, 500); 
}

function pauseSim() {
    if (!isRunning) return;
    isPaused = !isPaused;
    if (isPaused) {
        btnPause.textContent = '▶ Resume';
        log('Simulation Paused. Click a packet/ACK to select it.', 'network');
        clearInterval(simInterval); 
        
        if (currentAlgorithm === 'gbn') { pauseGBNTimer(); } 
        else { pauseAllSRTimers(); }
        
        document.querySelectorAll('.packet, .ack').forEach(p => {
            p.style.animationPlayState = 'paused';
            if (!p.classList.contains('lost')) {
                p.style.cursor = 'pointer'; // Make clickable
            }
        });
        
        btnDeleteSelected.disabled = true; // Disabled until one is selected
        
    } else {
        btnPause.textContent = '⏸ Pause';
        log('Simulation Resumed', 'network');
        
        if (currentAlgorithm === 'gbn') { resumeGBNTimer(); }
        else { resumeAllSRTimers(); }
        
        simInterval = setInterval(mainLoop, 500); 
        
        document.querySelectorAll('.packet, .ack').forEach(p => {
            p.style.animationPlayState = 'running';
            p.style.cursor = 'default'; // Make unclickable
        });
        
        // Deselect any selected element
        if (selectedElement) {
            selectedElement.element.classList.remove('selected');
            selectedElement = null;
        }
        btnDeleteSelected.disabled = true;
    }
}

function resetSim() {
    isRunning = false;
    isPaused = false;
    clearInterval(simInterval);
    
    clearGBNTimer();
    Object.values(srPacketTimers).forEach(t => clearTimeout(t.timerId));
    
    sendBase = 1;
    nextSeqNum = 1;
    packetBuffer = {};
    srPacketTimers = {};
    rcvBase = 1;
    rcvBuffer = {};
    selectedElement = null;
    
    simArea.querySelectorAll('.packet, .ack').forEach(p => p.remove());
    logArea.innerHTML = '<div>Simulation Reset. Click Start.</div>';
    receiverLogDiv.innerHTML = '';
    
    btnStart.disabled = false;
    algoSelect.disabled = false;
    btnPause.disabled = true;
    btnDeleteSelected.disabled = true;
    
    updateUI();
}

function mainLoop() {
    if (!isRunning || isPaused) return;
    
    if (nextSeqNum < sendBase + WINDOW_SIZE) {
        const isResend = (packetBuffer[nextSeqNum] !== undefined && packetBuffer[nextCNum].status === 'sent');
        log(`SENDER: ${isResend ? 'Re-sending' : 'Sending'} Packet ${nextSeqNum}`, 'sender');
        startPacket(nextSeqNum); 
        nextSeqNum++;
        updateUI(); 
    }
}

// NEW: Select function
function selectElement(type, seqNum, element) {
    if (!isPaused) return;

    // Deselect old element
    if (selectedElement) {
        selectedElement.element.classList.remove('selected');
    }

    // Select new element
    selectedElement = { type, seqNum, element };
    element.classList.add('selected');
    btnDeleteSelected.disabled = false;
}

// UPDATED: Delete function
function deleteSelected() {
    if (!isPaused || !selectedElement) return;

    const { type, seqNum, element } = selectedElement;

    element.classList.remove('selected');
    element.classList.add('lost');
    element.onclick = null; // Disable future clicks
    element.style.cursor = 'default';

    if (type === 'packet') {
        const packet = packetBuffer[seqNum];
        if (packet) { packet.status = 'lost'; }
        log(`NETWORK: User deleted Packet ${seqNum}!`, 'error');
    } else { // 'ack'
        element.isLost = true; // Set custom property
        log(`NETWORK: User deleted ACK ${seqNum}!`, 'error');
    }
    
    setTimeout(() => element.remove(), 300); // Fade away
    
    selectedElement = null;
    btnDeleteSelected.disabled = true;
}

// --- Packet & ACK Handling ---
function startPacket(seqNum) {
    if (packetBuffer[seqNum] && packetBuffer[seqNum].element) {
        packetBuffer[seqNum].element.remove();
    }
    
    const packetEl = document.createElement('div');
    packetEl.className = 'packet';
    packetEl.textContent = `P ${seqNum}`;
    packetEl.style.animationDuration = `${speedSlider.value}s`; 
    
    packetBuffer[seqNum] = { element: packetEl, status: 'sent' };
    
    // Add click listener for selection
    packetEl.onclick = () => { selectElement('packet', seqNum, packetEl); };
    
    if (currentAlgorithm === 'gbn') {
        if (sendBase === seqNum) {
            startGBNTimer();
        }
    } else { // SR
        startSRTimer(seqNum);
    }
    
    simArea.appendChild(packetEl);
    
    packetEl.onanimationend = () => {
        if (packetBuffer[seqNum] && packetBuffer[seqNum].status !== 'lost') {
            onPacketArrive(seqNum, packetEl);
        }
    };
}

function onPacketTimeout(seqNum) { // 'seqNum' is optional
    if (isPaused) { return; }

    if (currentAlgorithm === 'gbn') {
        log(`SENDER (GBN): Timeout for Packet ${sendBase}!`, 'error');
        log(`SENDER (GBN): Rewinding window to resend from ${sendBase}...`, 'sender');

        for (let i = sendBase; i < nextSeqNum; i++) {
            if (packetBuffer[i] && packetBuffer[i].element) {
                packetBuffer[i].element.remove(); 
            }
        }
        nextSeqNum = sendBase; // Rewind
    } else { // SR
        log(`SENDER (SR): Timeout for Packet ${seqNum}!`, 'error');
        log(`SENDER (SR): Re-sending Packet ${seqNum}...`, 'sender');
        startPacket(seqNum); // Resend only this packet
    }
}

function onPacketArrive(seqNum, packetEl) {
    if (isPaused) {
        setTimeout(() => onPacketArrive(seqNum, packetEl), 500);
        return;
    }
    packetEl.remove(); 
    
    if (currentAlgorithm === 'gbn') {
        handleGBNPacket(seqNum);
    } else {
        handleSRPacket(seqNum);
    }
}

function handleGBNPacket(seqNum) {
    if (seqNum === rcvBase) {
        log(`RECEIVER (GBN): Received Packet ${seqNum}. Sending ACK ${seqNum}.`, 'receiver');
        receiverLogDiv.innerHTML += `<div>Delivered Pkt ${seqNum}</div>`;
        startAck(seqNum);
        rcvBase++;
        updateReceiverInfo();
    } else {
        log(`RECEIVER (GBN): Discarded Packet ${seqNum} (Expected ${rcvBase}).`, 'receiver');
    }
}

function handleSRPacket(seqNum) {
    if (seqNum >= rcvBase && seqNum < rcvBase + WINDOW_SIZE) {
        log(`RECEIVER (SR): Received Packet ${seqNum}. Sending ACK ${seqNum}.`, 'receiver');
        startAck(seqNum); 
        
        if (seqNum === rcvBase) {
            receiverLogDiv.innerHTML += `<div>Delivered Pkt ${seqNum}</div>`;
            rcvBase++;
            
            while (rcvBuffer[rcvBase]) {
                log(`RECEIVER (SR): Delivering buffered Packet ${rcvBase}.`, 'receiver');
                receiverLogDiv.innerHTML += `<div>Delivered Pkt ${rcvBase}</div>`;
                delete rcvBuffer[rcvBase];
                rcvBase++;
            }
        } else {
            log(`RECEIVER (SR): Buffering Packet ${seqNum}.`, 'receiver');
            rcvBuffer[seqNum] = true;
        }
    } else if (seqNum < rcvBase) {
        log(`RECEIVER (SR): Received duplicate Pkt ${seqNum}. Sending ACK ${seqNum}.`, 'receiver');
        startAck(seqNum); 
    } else {
        log(`RECEIVER (SR): Discarded Packet ${seqNum} (Outside window).`, 'receiver');
    }
    updateReceiverInfo();
}

function startAck(ackNum) {
    const ackEl = document.createElement('div');
    ackEl.className = 'ack';
    ackEl.textContent = `A ${ackNum}`;
    ackEl.style.animationDuration = `${speedSlider.value}s`; 
    ackEl.isLost = false; // NEW: Property to track loss

    // Add click listener for selection
    ackEl.onclick = () => { selectElement('ack', ackNum, ackEl); };

    simArea.appendChild(ackEl);
    
    ackEl.onanimationend = () => {
        onAckArrive(ackNum, ackEl);
    };
}

function onAckArrive(ackNum, ackEl) {
    if (isPaused) {
        setTimeout(() => onAckArrive(ackNum, ackEl), 500);
        return;
    }
    
    // NEW: Check if this ACK was lost
    if (ackEl.isLost) {
        ackEl.remove();
        return; // Do not process
    }

    ackEl.remove(); 
    
    if (currentAlgorithm === 'gbn') {
        handleGBNAck(ackNum);
    } else {
        handleSRAck(ackNum);
    }
}

function handleGBNAck(ackNum) {
    log(`SENDER (GBN): Received ACK ${ackNum}.`, 'sender');
    if (ackNum >= sendBase) {
        for (let i = sendBase; i <= ackNum; i++) {
            if (packetBuffer[i]) { packetBuffer[i].status = 'acked'; }
        }
        sendBase = ackNum + 1; 
        
        if (sendBase < nextSeqNum) {
            startGBNTimer(); 
        } else {
            log(`SENDER (GBN): All packets ACKed. Timer stopped.`, 'sender');
            clearGBNTimer();
        }
    } else {
         log(`SENDER (GBN): Ignored duplicate ACK ${ackNum}.`, 'sender');
    }
    updateUI(); 
}

function handleSRAck(ackNum) {
    log(`SENDER (SR): Received ACK ${ackNum}.`, 'sender');
    
    if (packetBuffer[ackNum]) {
        packetBuffer[ackNum].status = 'acked';
    }
    clearSRTimer(ackNum); 
    
    if (ackNum === sendBase) {
        log(`SENDER (SR): Base packet ${sendBase} ACKed. Sliding window...`, 'sender');
        while (packetBuffer[sendBase] && packetBuffer[sendBase].status === 'acked') {
            sendBase++;
        }
        log(`SENDER (SR): New window base is ${sendBase}.`, 'sender');
    }
    updateUI();
}

// --- UI Update Functions ---
function updateUI() {
    senderInfo.textContent = `Base: ${sendBase}, NextSeq: ${nextSeqNum}`;
    
    if (currentAlgorithm === 'gbn') {
        receiverInfo.textContent = `Expected: ${rcvBase}`;
        receiverBufferDiv.style.display = 'none'; 
    } else { // SR
        receiverInfo.textContent = `RcvBase: ${rcvBase}`;
        receiverBufferDiv.style.display = 'block'; 
        const bufferKeys = Object.keys(rcvBuffer).map(Number).sort((a,b) => a-b);
        receiverBufferDiv.textContent = `Buffer: [ ${bufferKeys.join(', ')} ]`;
    }
    
    senderWindowVisual.innerHTML = '';
    const maxSeq = Math.max(nextSeqNum + 2, sendBase + WINDOW_SIZE + 2, 10);
    for (let i = maxSeq; i >= 1; i--) {
        const box = document.createElement('div');
        box.className = 'seq-box';
        box.textContent = i;
        
        const pkt = packetBuffer[i];
        
        if (pkt && pkt.status === 'acked') {
            box.classList.add('acked');
        } else if (i >= sendBase && i < (sendBase + WINDOW_SIZE)) {
            box.classList.add('in-window');
            if (pkt && pkt.status === 'sent') {
                box.classList.add('sent');
            }
        }
        senderWindowVisual.appendChild(box);
    }
}
function updateReceiverInfo() {
    if (currentAlgorithm === 'gbn') {
        receiverInfo.textContent = `Expected: ${rcvBase}`;
    } else {
        receiverInfo.textContent = `RcvBase: ${rcvBase}`;
        const bufferKeys = Object.keys(rcvBuffer).map(Number).sort((a,b) => a-b);
        receiverBufferDiv.textContent = `Buffer: [ ${bufferKeys.join(', ')} ]`;
    }
}

// Initial setup
resetSim();
