require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const crypto = require('crypto');
const mongoose = require('mongoose');
const nodemailer = require('nodemailer');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const mongoSanitize = require('express-mongo-sanitize');
const xss = require('xss-clean');
const app = express();
const port = process.env.PORT || 3000;

// --- DATABASE CONNECTION ---
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('MongoDB ga muvaffaqiyatli ulandi'))
    .catch(err => console.error('MongoDB ulanishda xatolik:', err));

// --- DATABASE MODELS (SCHEMA) ---
const contactSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true },
    message: { type: String, required: true },
    createdAt: { type: Date, default: Date.now }
});
const Contact = mongoose.model('Contact', contactSchema);

// --- SUPPORT MODEL ---
const supportSchema = new mongoose.Schema({
    ticketId: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    email: { type: String, required: true }, // Encrypted
    issueType: { type: String, required: true }, // Masalan: 'Bug', 'Account', 'Other'
    description: { type: String, required: true }, // Encrypted
    status: { type: String, default: 'open' }, // open, closed, pending
    createdAt: { type: Date, default: Date.now }
});
const Support = mongoose.model('Support', supportSchema);

// Middleware
app.use(helmet({
    contentSecurityPolicy: false, // Frontenddagi CDN skriptlari (marked, lenis) ishlashi uchun
    crossOriginEmbedderPolicy: false
}));
app.use(cors({
    origin: '*', // Productionda aniq domenni yozish tavsiya etiladi (masalan: 'https://creata.uz')
    methods: ['GET', 'POST']
}));
app.use(express.json({ limit: '10kb' })); // DoS hujumidan himoya: faqat kichik hajmli JSON qabul qilish
app.use(mongoSanitize()); // NoSQL Injection (baza buzish) oldini olish
app.use(xss()); // XSS (zararli skriptlar) tozalash

// --- FAVICON (Serverdan to'g'ridan-to'g'ri logo yuborish) ---
app.get('/favicon.ico', (req, res) => {
    const svg = `
    <svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'>
        <circle cx='50' cy='50' r='50' fill='#D4AF37'/>
        <text x='50' y='75' font-size='70' text-anchor='middle' fill='#000000' font-family='serif'>C</text>
    </svg>`;
    res.setHeader('Content-Type', 'image/svg+xml');
    res.send(svg);
});

// Fayllar asosiy papkada bo'lgani uchun 'public' ni olib tashlaymiz yoki __dirname ishlatamiz
// Xavfsizlik uchun faqat kerakli statik fayllarni ruxsat berish tavsiya etiladi, hozircha sodda yechim:
app.use(express.static(__dirname));

// --- RATE LIMITING (Xavfsizlik) ---
// Chat uchun: 1 daqiqada maksimum 10 ta so'rov
const chatLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, 
    max: 10,
    message: { reply: "Juda ko'p so'rov yubordingiz. Iltimos 1 daqiqadan so'ng urinib ko'ring." }
});

// Kontakt forma uchun: 1 soatda maksimum 50 ta xabar (Ko'paytirildi)
const contactLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 50,
    message: { success: false, message: "Xavfsizlik maqsadida xabar yuborish vaqtincha cheklandi." }
});

// Support uchun: 1 soatda maksimum 50 ta ticket (Ko'paytirildi)
const supportLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 50,
    message: { success: false, message: "Juda ko'p so'rov. Iltimos keyinroq urinib ko'ring." }
});

// --- API ROUTES ---

// 1. Chat Bot API
app.post('/api/chat', chatLimiter, async (req, res) => {
    try {
        const userMessage = req.body.message;
        if (!userMessage || typeof userMessage !== 'string') return res.json({ reply: "Iltimos, biror narsa yozing." });

        // AI modelini sozlash
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

        // AI ga shaxsiyat berish (System Prompt)
        const prompt = `
            Sen Creata AI san, kelajak texnologiyalari bo'yicha yordamchisan.
            Sening asosching: Ikrom Islomov (Front-End dasturchi va Kiberxavfsizlik mutaxassisi).
            Vazifang: Foydalanuvchilarga Creata kompaniyasi, veb dasturlash va IT sohasida yordam berish.
            Javoblaring qisqa, aniq va o'zbek tilida bo'lsin.
            Foydalanuvchi savoli: ${userMessage}
        `;

        const result = await model.generateContent(prompt);
        const response = await result.response;
        res.json({ reply: response.text() });
    } catch (error) {
        console.error("AI Xatolik:", error);
        res.status(500).json({ reply: "Uzr, hozircha serverda nosozlik bor. Keyinroq urinib ko'ring." });
    }
});

// 2. Contact Form API
app.post('/api/contact', contactLimiter, async (req, res) => {
    const { name, email, message } = req.body;

    if (!name || !email || !message) {
        return res.status(400).json({ success: false, message: "Barcha maydonlarni to'ldiring." });
    }

    // Email validatsiyasi
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        return res.status(400).json({ success: false, message: "Noto'g'ri email formati." });
    }

    try {
        // 1. Bazaga shifrlab saqlash (Xavfsizlik)
        // DIQQAT: .env faylda ENCRYPTION_KEY bo'lishi kerak.
        const algorithm = 'aes-256-cbc';
        const key = process.env.ENCRYPTION_KEY ? Buffer.from(process.env.ENCRYPTION_KEY, 'hex') : crypto.randomBytes(32);

        const encrypt = (text) => {
            const iv = crypto.randomBytes(16); // Har bir shifrlash uchun unikal IV
            const cipher = crypto.createCipheriv(algorithm, key, iv);
            let encrypted = cipher.update(text);
            encrypted = Buffer.concat([encrypted, cipher.final()]);
            return iv.toString('hex') + ':' + encrypted.toString('hex');
        };

        const newContactMessage = new Contact({ 
            name, 
            email: encrypt(email), 
            message: encrypt(message) 
        });
        await newContactMessage.save();

        // 2. Email yuborish (Nodemailer)
        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: process.env.EMAIL_USER, // .env faylidan olinadi
                pass: process.env.EMAIL_PASS  // .env faylidan olinadi (App Password)
            }
        });

        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: 'ikoshdev@gmail.com', // Xabar boradigan manzil
            replyTo: email, // Javob yozish tugmasini bosganda mijoz emaili chiqadi
            subject: `Creata Portfolio: Yangi xabar - ${name}`,
            text: `Sizga quyidagi foydalanuvchi xabar yubordi:\n\nIsm: ${name}\nEmail: ${email}\n\nXabar:\n${message}`
        };

        // Foydalanuvchiga avtomatik javob xati (Auto-reply)
        const autoReplyOptions = {
            from: process.env.EMAIL_USER,
            to: email, // Foydalanuvchi kiritgan email
            subject: 'Creata: Xabaringizni qabul qildik',
            text: `Assalomu alaykum, ${name}!\n\nBizga bog'langaningiz uchun rahmat. Xabaringizni qabul qildik va tez orada sizga javob qaytaramiz.\n\nHurmat bilan,\nIkrom Islomov (Creata Founder)`
        };

        await transporter.sendMail(mailOptions);
        await transporter.sendMail(autoReplyOptions);

        console.log(`Yangi xabar bazaga saqlandi va email yuborildi: ${name} (${email})`);
        res.status(201).json({ success: true, message: "Xabaringiz muvaffaqiyatli yuborildi!" });
    } catch (error) {
        console.error("Xabarni saqlashda yoki yuborishda xatolik:", error);
        // Xatolikni aniqroq qaytaramiz (Login/Parol xato bo'lsa ko'rinadi)
        res.status(500).json({ success: false, message: "Xatolik: " + error.message });
    }
});

// 3. Support Ticket API
app.post('/api/support', supportLimiter, async (req, res) => {
    const { name, email, issueType, description } = req.body;

    if (!name || !email || !issueType || !description) {
        return res.status(400).json({ success: false, message: "Barcha maydonlarni to'ldiring." });
    }

    try {
        // Ticket ID generatsiya qilish (Masalan: #A1B2C3)
        const ticketId = '#' + crypto.randomBytes(3).toString('hex').toUpperCase();

        // Shifrlash funksiyasi
        const algorithm = 'aes-256-cbc';
        const key = process.env.ENCRYPTION_KEY ? Buffer.from(process.env.ENCRYPTION_KEY, 'hex') : crypto.randomBytes(32);
        
        const encrypt = (text) => {
            const iv = crypto.randomBytes(16);
            const cipher = crypto.createCipheriv(algorithm, key, iv);
            let encrypted = cipher.update(text);
            encrypted = Buffer.concat([encrypted, cipher.final()]);
            return iv.toString('hex') + ':' + encrypted.toString('hex');
        };

        // Bazaga saqlash
        const newTicket = new Support({
            ticketId,
            name,
            email: encrypt(email),
            issueType,
            description: encrypt(description)
        });
        await newTicket.save();

        // Email yuborish
        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASS
            }
        });

        // Adminga xabar
        const adminMailOptions = {
            from: process.env.EMAIL_USER,
            to: 'ikoshdev@gmail.com',
            subject: `🔥 Yangi Support Ticket: ${ticketId} [${issueType}]`,
            text: `Yangi muammo kelib tushdi:\n\nTicket ID: ${ticketId}\nIsm: ${name}\nTur: ${issueType}\n\nMuammo: ${description}`
        };

        // Foydalanuvchiga tasdiqlash xati
        const userMailOptions = {
            from: process.env.EMAIL_USER,
            to: email,
            subject: `Creata Support: Ticket ${ticketId} qabul qilindi`,
            text: `Assalomu alaykum, ${name}!\n\nSizning murojaatingiz qabul qilindi. Sizning Ticket raqamingiz: ${ticketId}.\n\nTez orada mutaxassislarimiz ko'rib chiqib, javob berishadi.\n\nMuammo turi: ${issueType}`
        };

        await transporter.sendMail(adminMailOptions);
        await transporter.sendMail(userMailOptions);

        res.status(201).json({ success: true, message: `Murojaat qabul qilindi! Ticket ID: ${ticketId}` });

    } catch (error) {
        console.error("Support xatolik:", error);
        res.status(500).json({ success: false, message: "Xatolik: " + error.message });
    }
});

// --- ADMIN PANEL API (Xavfsiz hudud) ---

// Yordamchi funksiya: Ma'lumotni deshifrlash
const decrypt = (text) => {
    if (!text || !text.includes(':')) return text; // Shifrlanmagan bo'lsa qaytarib yuborish
    try {
        const textParts = text.split(':');
        const iv = Buffer.from(textParts.shift(), 'hex');
        const encryptedText = Buffer.from(textParts.join(':'), 'hex');
        const key = process.env.ENCRYPTION_KEY ? Buffer.from(process.env.ENCRYPTION_KEY, 'hex') : crypto.randomBytes(32);
        const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
        let decrypted = decipher.update(encryptedText);
        decrypted = Buffer.concat([decrypted, decipher.final()]);
        return decrypted.toString();
    } catch (err) {
        return "[Decryption Error]";
    }
};

// Middleware: Admin ekanligini tekshirish (Oddiy usul)
const isAdmin = (req, res, next) => {
    const adminKey = req.headers['x-admin-key'];
    // .env faylda ADMIN_SECRET=biror_maxfiy_soz bo'lishi kerak
    if (adminKey && adminKey === process.env.ADMIN_SECRET) {
        next();
    } else {
        res.status(403).json({ success: false, message: "Ruxsat yo'q!" });
    }
};

// 1. Barcha ticketlarni olish
app.get('/api/admin/tickets', isAdmin, async (req, res) => {
    try {
        const tickets = await Support.find().sort({ createdAt: -1 });
        // Ma'lumotlarni deshifrlab jo'natamiz
        const decryptedTickets = tickets.map(ticket => ({
            ...ticket._doc,
            email: decrypt(ticket.email),
            description: decrypt(ticket.description)
        }));
        res.json({ success: true, tickets: decryptedTickets });
    } catch (error) {
        res.status(500).json({ success: false, message: "Server xatosi" });
    }
});

// 2. Ticket statusini o'zgartirish
app.put('/api/admin/tickets/:id', isAdmin, async (req, res) => {
    try {
        const { status } = req.body; // 'closed' yoki 'pending'
        await Support.findByIdAndUpdate(req.params.id, { status });
        res.json({ success: true, message: "Status yangilandi" });
    } catch (error) {
        res.status(500).json({ success: false, message: "Yangilashda xatolik" });
    }
});

// SPA (Single Page Application) Support
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(port, () => {
    console.log(`Server http://localhost:${port} manzilida ishga tushdi`);
});