const express = require('express');
const fs = require('fs');
const fsPromises = require('fs/promises');
const path = require('path');
const multer = require('multer');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT || 3001;

const uploadDir = path.join(__dirname, 'uploads');
const DATA_FILE = path.join(__dirname, 'products.json');

// Crear carpeta uploads si no existe
fsPromises.mkdir(uploadDir, { recursive: true }).then(() => {
  console.log('✅ Carpeta "uploads/" lista');
}).catch(err => {
  console.error('❌ Error al crear carpeta uploads:', err);
  process.exit(1);
});

// Multer configuración
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});

const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Solo se permiten imágenes'));
    }
    cb(null, true);
  }
});

// Middleware
app.use(cors({
  origin: ['http://localhost:5500', 'http://127.0.0.1:5500', 'https://mercado-vive.onrender.com', 'https://mercadovive.com'],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-requested-with']
}));
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, '..')));
app.use('/uploads', express.static(uploadDir));

// Redirección www
app.use((req, res, next) => {
  if (req.headers.host?.startsWith('www.')) {
    return res.redirect(301, `${req.protocol}://${req.headers.host.replace('www.', '')}${req.originalUrl}`);
  }
  next();
});

// Helpers de productos
function loadProducts() {
  try {
    if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, '[]');
    const data = fs.readFileSync(DATA_FILE, 'utf8').trim();
    if (!data) return [];
    const products = JSON.parse(data);
    return Array.isArray(products) ? products : [];
  } catch (err) {
    console.error('❌ Error al cargar productos:', err);
    return [];
  }
}

function saveProducts(products) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(products, null, 2), 'utf8');
  } catch (err) {
    console.error('❌ Error al guardar productos:', err);
  }
}

// Autenticación
const users = [
  { username: process.env.ADMIN_USER || "admin", password: process.env.ADMIN_PASS || "admin123", role: "admin" },
  { username: process.env.EDITOR_USER || "editor", password: process.env.EDITOR_PASS || "editor123", role: "editor" }
];

function authenticateUser(authHeader) {
  if (!authHeader?.startsWith('Basic ')) return { error: 'Autenticación requerida', status: 401 };
  try {
    const [username, password] = Buffer.from(authHeader.split(' ')[1], 'base64').toString().split(':');
    const user = users.find(u => u.username === username && u.password === password);
    return user ? { user } : { error: 'Credenciales inválidas', status: 401 };
  } catch {
    return { error: 'Formato inválido', status: 400 };
  }
}

function authenticate(req, res, next) {
  const result = authenticateUser(req.headers.authorization);
  if (result.error) return res.status(result.status).json({ error: result.error });
  req.user = result.user;
  next();
}

// API LOGIN
app.post('/api/login', (req, res) => {
  const result = authenticateUser(req.headers.authorization);
  if (result.error) return res.status(result.status).json({ error: result.error });
  res.json({ message: 'Autenticación exitosa', user: { username: result.user.username, role: result.user.role } });
});

// GET productos
app.get('/api/products', (req, res) => {
  const products = loadProducts();
  res.json(products);
});

// POST producto
app.post('/api/products', authenticate, (req, res) => {
  const products = loadProducts();
  if (products.length >= 50) {
    return res.status(403).json({ error: 'Límite de 50 productos alcanzado' });
  }

  const { nombre, precio, ...rest } = req.body;
  if (!nombre || typeof nombre !== 'string') return res.status(400).json({ error: 'Nombre requerido' });

  const parsedPrecio = typeof precio === 'string' ? parseFloat(precio) : precio;
  if (typeof parsedPrecio !== 'number' || isNaN(parsedPrecio) || parsedPrecio <= 0) {
    return res.status(400).json({ error: 'Precio debe ser un número positivo' });
  }

  const newProduct = { id: `${Date.now()}-${Math.floor(Math.random() * 1000)}`, nombre, precio: parsedPrecio, ...rest };
  products.push(newProduct);
  saveProducts(products);
  res.status(201).json(newProduct);
});

// PUT producto
app.put('/api/products/:id', authenticate, (req, res) => {
  const products = loadProducts();
  const index = products.findIndex(p => p.id === req.params.id);
  if (index === -1) return res.status(404).json({ error: 'Producto no encontrado' });

  const { nombre, precio, ...rest } = req.body;
  if (!nombre || typeof nombre !== 'string') return res.status(400).json({ error: 'Nombre requerido' });

  const parsedPrecio = typeof precio === 'string' ? parseFloat(precio) : precio;
  if (typeof parsedPrecio !== 'number' || isNaN(parsedPrecio) || parsedPrecio <= 0) {
    return res.status(400).json({ error: 'Precio debe ser un número positivo' });
  }

  const updated = { ...products[index], nombre, precio: parsedPrecio, ...rest };
  products[index] = updated;
  saveProducts(products);
  res.json(updated);
});

// DELETE producto
app.delete('/api/products/:id', authenticate, (req, res) => {
  const products = loadProducts();
  const index = products.findIndex(p => p.id === req.params.id);
  if (index === -1) return res.status(404).json({ error: 'Producto no encontrado' });

  const deleted = products.splice(index, 1)[0];
  saveProducts(products);
  res.json(deleted);
});

// SUBIDA imagen
app.post('/api/upload', authenticate, (req, res) => {
  upload.single('imagen')(req, res, (err) => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE' ? 'La imagen excede 2 MB' : err.message;
      return res.status(400).json({ error: msg });
    }

    if (!req.file) return res.status(400).json({ error: 'No se subió imagen' });

    const imageUrl = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
    res.json({ imageUrl });
  });
});

// HTML y rutas raíz
app.get('/', (req, res) => res.sendFile(path.join(__dirname, '../index.html')));
app.get('/admin/admin.html', (req, res) => res.sendFile(path.join(__dirname, '../admin/admin.html')));
app.get('/admin/login.html', (req, res) => res.sendFile(path.join(__dirname, '../admin/login.html')));
app.get('/api', (req, res) => {
  res.send(`<h1>API MercadoVive</h1><ul>
    <li><a href="/api/products">GET /api/products</a></li>
    <li>POST /api/products</li>
    <li>PUT /api/products/:id</li>
    <li>DELETE /api/products/:id</li></ul>`);
});

// Manejo de errores
app.use((req, res) => res.status(404).json({ error: 'Ruta no encontrada' }));
app.use((err, req, res, next) => {
  console.error('Error no manejado:', err);
  res.status(500).json({ error: 'Error interno del servidor' });
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`✅ Servidor activo en http://localhost:${PORT}`);
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, '[]');
    console.log('📄 Archivo products.json creado');
  }
});
