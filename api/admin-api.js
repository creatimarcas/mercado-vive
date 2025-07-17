const express = require('express');
const fs = require('fs');
const fsPromises = require('fs/promises');
const path = require('path');

const uploadDir = path.join(__dirname, 'uploads');

// Crear carpeta 'uploads' si no existe
fsPromises.mkdir(uploadDir, { recursive: true })
  .then(() => {
    console.log('✅ Carpeta "uploads/" lista');
  })
  .catch(err => {
    console.error('❌ Error al crear la carpeta "uploads/":', err);
    process.exit(1);
  });

const multer = require('multer');

// Configuración de almacenamiento
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const uniqueName = `${Date.now()}-${file.originalname}`;
    cb(null, uniqueName);
  }
});

// Validación de tipo y tamaño
const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2 MB
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Solo se permiten archivos de imagen'));
    }
    cb(null, true);
  }
});

const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT || 3001;
const DATA_FILE = path.join(__dirname, 'products.json');

// ⬇️ Redirección de www a sin www
app.use((req, res, next) => {
  const host = req.headers.host;
  if (host && host.startsWith('www.')) {
    const newHost = host.replace('www.', '');
    return res.redirect(301, `${req.protocol}://${newHost}${req.originalUrl}`);
  }
  next();
});

// Configuración mejorada de CORS
const corsOptions = {
  origin: [
    'http://localhost:5500',
    'http://127.0.0.1:5500',
    'https://mercado-vive.onrender.com',
    'https://mercadovive.com'
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-requested-with']
};

app.use(cors(corsOptions));
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, '..')));
app.options('*', cors(corsOptions));

// Funciones helper
function loadProducts() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      fs.writeFileSync(DATA_FILE, '[]');
      return [];
    }
    const data = fs.readFileSync(DATA_FILE, 'utf8');
    const products = JSON.parse(data);

    const ids = new Set();
    products.forEach(product => {
      if (ids.has(product.id)) {
        console.warn(`⚠️ ID duplicado detectado: ${product.id}`);
      }
      ids.add(product.id);
    });

    return products;
  } catch (err) {
    console.error("Error loading products:", err);
    return [];
  }
}

function saveProducts(products) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(products, null, 2), 'utf8');
  } catch (err) {
    console.error("Error saving products:", err);
    throw new Error("Error al guardar productos");
  }
}

// Autenticación
const users = [
  {
    username: process.env.ADMIN_USER || "admin",
    password: process.env.ADMIN_PASS || "admin123",
    role: "admin"
  },
  {
    username: process.env.EDITOR_USER || "editor",
    password: process.env.EDITOR_PASS || "editor123",
    role: "editor"
  }
];

function authenticateUser(authHeader) {
  if (!authHeader || !authHeader.startsWith('Basic ')) {
    return { error: 'Autenticación requerida', status: 401 };
  }

  const base64Credentials = authHeader.split(' ')[1];
  if (!base64Credentials) {
    return { error: 'Credenciales vacías', status: 401 };
  }

  try {
    const credentials = Buffer.from(base64Credentials, 'base64').toString().split(':');
    const [username, password] = credentials;
    const user = users.find(u => u.username === username && u.password === password);

    return user
      ? { user }
      : { error: 'Credenciales inválidas', status: 401 };
  } catch (error) {
    console.error('Error en autenticación:', error);
    return { error: 'Formato de autenticación inválido', status: 400 };
  }
}

function authenticate(req, res, next) {
  const result = authenticateUser(req.headers.authorization);
  if (result.error) {
    return res.status(result.status).json({ error: result.error });
  }
  req.user = result.user;
  next();
}

// Login
app.post('/api/login', (req, res) => {
  const result = authenticateUser(req.headers.authorization);
  if (result.error) {
    return res.status(result.status).json({ error: result.error });
  }
  res.json({
    message: 'Autenticación exitosa',
    user: {
      username: result.user.username,
      role: result.user.role
    }
  });
});

// GET productos (público)
app.get('/api/products', (req, res) => {
  try {
    const products = loadProducts();
    res.json(products);
  } catch (error) {
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// POST producto (protegido)
app.post('/api/products', authenticate, (req, res) => {
  const MAX_PRODUCTS = 50;
  const currentProducts = loadProducts();
  if (currentProducts.length >= MAX_PRODUCTS) {
    return res.status(403).json({
      error: `Límite de ${MAX_PRODUCTS} productos alcanzado.`,
      suggestion: "Contacte al administrador"
    });
  }

  const newProduct = req.body;
  if (!newProduct.nombre || typeof newProduct.nombre !== 'string') {
    return res.status(400).json({ error: 'Nombre es requerido y debe ser texto' });
  }

  if (typeof newProduct.precio === 'string') {
    newProduct.precio = parseFloat(newProduct.precio);
  }

  if (typeof newProduct.precio !== 'number' || isNaN(newProduct.precio) || newProduct.precio <= 0) {
    return res.status(400).json({ error: 'Precio debe ser un número positivo' });
  }

  try {
    const products = loadProducts();
    newProduct.id = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    products.push(newProduct);
    saveProducts(products);
    res.status(201).json(newProduct);
  } catch (error) {
    res.status(500).json({ error: 'Error al guardar producto', details: error.message });
  }
});

// PUT producto
app.put('/api/products/:id', authenticate, (req, res) => {
  const productId = req.params.id;
  const updatedProduct = req.body;

  if (!updatedProduct.nombre || typeof updatedProduct.nombre !== 'string') {
    return res.status(400).json({ error: 'Nombre es requerido y debe ser texto' });
  }

  if (typeof updatedProduct.precio === 'string') {
    updatedProduct.precio = parseFloat(updatedProduct.precio);
  }

  if (typeof updatedProduct.precio !== 'number' || isNaN(updatedProduct.precio) || updatedProduct.precio <= 0) {
    return res.status(400).json({ error: 'Precio debe ser un número positivo' });
  }

  try {
    const products = loadProducts();
    const index = products.findIndex(p => p.id === productId);
    if (index === -1) {
      return res.status(404).json({ error: 'Producto no encontrado' });
    }

    updatedProduct.id = productId;
    products[index] = updatedProduct;
    saveProducts(products);
    res.json(updatedProduct);
  } catch (error) {
    res.status(500).json({ error: 'Error al actualizar producto', details: error.message });
  }
});

// DELETE producto
app.delete('/api/products/:id', authenticate, (req, res) => {
  const productId = req.params.id;
  try {
    const products = loadProducts();
    const newProducts = products.filter(p => p.id !== productId);
    if (products.length === newProducts.length) {
      return res.status(404).json({ error: 'Producto no encontrado' });
    }

    saveProducts(newProducts);
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: 'Error al eliminar producto', details: error.message });
  }
});

// Subida de imágenes
app.post('/api/upload', authenticate, (req, res) => {
  upload.single('imagen')(req, res, function (err) {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'La imagen excede 2 MB' });
      }
      return res.status(400).json({ error: err.message });
    } else if (err) {
      return res.status(400).json({ error: err.message });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No se subió ninguna imagen' });
    }

    const imageUrl = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
    res.json({ imageUrl });
  });
});

// Servir imágenes
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Vistas HTML
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../index12.html'));
});

app.get('/admin/admin.html', (req, res) => {
  res.sendFile(path.join(__dirname, '../admin/admin.html'));
});

app.get('/admin/login.html', (req, res) => {
  res.sendFile(path.join(__dirname, '../admin/login.html'));
});

// Ruta raíz de API
app.get('/api', (req, res) => {
  res.send(`
    <h1>API de MercadoVive</h1>
    <ul>
      <li><a href="/api/products">GET /api/products</a></li>
      <li>POST /api/products</li>
      <li>PUT /api/products/:id</li>
      <li>DELETE /api/products/:id</li>
    </ul>
  `);
});

// Errores
app.use((req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada' });
});

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
