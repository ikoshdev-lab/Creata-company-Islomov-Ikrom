window.addEventListener('load', () => {
    setTimeout(() => {
        const loader = document.getElementById('loader');
        loader.classList.add('hidden');
        setTimeout(() => loader.style.display = 'none', 1000);
    }, 2500);
});

const navbar = document.querySelector('.navbar');
window.addEventListener('scroll', () => {
    if (window.scrollY > 50) navbar.classList.add('scrolled');
    else navbar.classList.remove('scrolled');
});

const lenis = new Lenis();
function raf(time) {
  lenis.raf(time);
  requestAnimationFrame(raf);
}
requestAnimationFrame(raf);

const cursorDot = document.querySelector('.cursor-dot');
const cursorOutline = document.querySelector('.cursor-outline');
const spotlight = document.getElementById('spotlight');

window.addEventListener('mousemove', (e) => {
    const posX = e.clientX;
    const posY = e.clientY;
    cursorDot.style.left = `${posX}px`;
    cursorDot.style.top = `${posY}px`;
    cursorOutline.animate({ left: `${posX}px`, top: `${posY}px` }, { duration: 500, fill: "forwards" });
    spotlight.style.setProperty('--x', `${posX}px`);
    spotlight.style.setProperty('--y', `${posY}px`);
});

document.querySelectorAll('a, button, .hover-target').forEach(el => {
    el.addEventListener('mouseenter', () => {
        cursorOutline.classList.add('hovered');
        cursorDot.style.transform = 'scale(1.5)';
    });
    el.addEventListener('mouseleave', () => {
        cursorOutline.classList.remove('hovered');
        cursorDot.style.transform = 'scale(1)';
    });
});

const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) entry.target.classList.add('is-visible');
    });
}, { threshold: 0.1 });

document.querySelectorAll('.fade-in-section').forEach(section => observer.observe(section));

function toggleTheme() {
    const body = document.body;
    if (body.getAttribute('data-theme') === 'light') body.removeAttribute('data-theme');
    else body.setAttribute('data-theme', 'light');
}

const canvas = document.getElementById('hero-particles');
const ctx = canvas.getContext('2d');
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;
const particlesArray = [];
class Particle {
    constructor() {
        this.x = Math.random() * canvas.width;
        this.y = Math.random() * canvas.height;
        this.size = Math.random() * 2;
        this.speedX = Math.random() * 0.5 - 0.25;
        this.speedY = Math.random() * 0.5 - 0.25;
    }
    update() {
        this.x += this.speedX;
        this.y += this.speedY;
        if (this.size > 0.2) this.size -= 0.01;
        if (this.size <= 0.2 || this.x < 0 || this.x > canvas.width || this.y < 0 || this.y > canvas.height) {
            this.x = Math.random() * canvas.width;
            this.y = Math.random() * canvas.height;
            this.size = Math.random() * 2;
        }
    }
    draw() {
        ctx.fillStyle = 'rgba(212, 175, 55, 0.3)';
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
        ctx.fill();
    }
}
function initParticles() { for (let i = 0; i < 50; i++) particlesArray.push(new Particle()); }
function animateParticles() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < particlesArray.length; i++) {
        particlesArray[i].update();
        particlesArray[i].draw();
    }
    requestAnimationFrame(animateParticles);
}

// Ekranni o'lchami o'zgarganda (Telefonni aylantirganda) canvasni yangilash
window.addEventListener('resize', () => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
});

initParticles();
animateParticles();

const timelineItems = document.querySelectorAll('.timeline-item');
const timelineObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) entry.target.classList.add('active-milestone');
        else entry.target.classList.remove('active-milestone');
    });
}, { rootMargin: '-40% 0px -40% 0px', threshold: 0 });
timelineItems.forEach(item => timelineObserver.observe(item));

// --- BACKEND LOGIC ---
const chatInput = document.getElementById('chat-input');
const chatSendBtn = document.getElementById('chat-send-btn');
const chatBox = document.getElementById('chat-box');

// Load history
const savedChat = localStorage.getItem('chatHistory');
if (savedChat) {
    const history = JSON.parse(savedChat);
    if (history.length > 0) {
        chatBox.innerHTML = ''; 
        history.forEach(msg => addMessage(msg.text, msg.isBot, false));
    }
}

function addMessage(text, isBot = false, save = true) {
    const msgDiv = document.createElement('div');
    msgDiv.classList.add('msg');
    if(isBot) {
        msgDiv.classList.add('bot');
        msgDiv.innerHTML = marked.parse(text);
    } else {
        msgDiv.style.cssText = "margin-left: auto; background: rgba(255, 255, 255, 0.05);";
        msgDiv.innerText = text;
    }
    chatBox.appendChild(msgDiv);
    chatBox.scrollTop = chatBox.scrollHeight;

    if (save) {
        const history = JSON.parse(localStorage.getItem('chatHistory')) || [];
        history.push({ text, isBot });
        localStorage.setItem('chatHistory', JSON.stringify(history));
    }
}

async function handleChat() {
    const text = chatInput.value.trim();
    if(!text) return;
    addMessage(text, false);
    chatInput.value = '';

    if (!navigator.onLine) {
        addMessage("Internetga ulanmagansiz", true);
        return;
    }
    
    try {
        const response = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: text }) });
        const data = await response.json();
        addMessage(data.reply, true);
    } catch (error) { addMessage("Tarmoq xatosi", true); }
}
chatSendBtn.addEventListener('click', handleChat);
chatInput.addEventListener('keypress', (e) => { if(e.key === 'Enter') handleChat(); });

const contactForm = document.getElementById('contact-form');
contactForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = contactForm.querySelector('button');
    btn.innerText = 'Yuborilmoqda...';
    
    try {
        const formData = new FormData(contactForm);
        const response = await fetch('/api/contact', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.fromEntries(formData)) });
        const result = await response.json();
        if(result.success) { 
            btn.innerText = 'Yuborildi!'; 
            btn.style.color = '#4CAF50'; 
            contactForm.reset();
            setTimeout(() => { btn.innerText = 'Send Message'; btn.style.color = ''; }, 3000);
        }
    } catch (error) { btn.innerText = 'Xatolik!'; }
});

// --- SUPPORT FORM HANDLER ---
const supportForm = document.getElementById('support-form');
if (supportForm) {
    supportForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = supportForm.querySelector('button');
        const originalText = btn.innerText;
        btn.innerText = 'Yuborilmoqda...';
        
        try {
            const formData = new FormData(supportForm);
            const response = await fetch('/api/support', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.fromEntries(formData)) });
            const result = await response.json();
            if(result.success) { alert(result.message); supportForm.reset(); }
            else { alert(result.message); }
        } catch (error) { alert("Tarmoq xatosi!"); }
        finally { btn.innerText = originalText; }
    });
}

// --- MODAL LOGIC ---
const modal = document.getElementById('support-modal');
const openBtn = document.getElementById('open-support-btn');
const closeBtn = document.getElementById('close-support-btn');

if (openBtn && modal && closeBtn) {
    openBtn.addEventListener('click', () => modal.classList.remove('hidden'));
    closeBtn.addEventListener('click', () => modal.classList.add('hidden'));
    
    modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.classList.add('hidden');
    });
}