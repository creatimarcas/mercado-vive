const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;
const DATA_FILE = path.join(__dirname, 'products.json');

// Configuración mejorada de CORS
const corsOptions = {
  origin: ['http://localhost:5500', 
           'http://127.0.0.1:5500',
           'https://mercado-vive.onrender.com'],

  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
  'Content-Type', 
  'Authorization',
  'x-requested-with'  // Nuevo encabezado permitido
]
};

app.use(cors(corsOptions));
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, '..')));

// Manejar solicitudes OPTIONS (preflight)
app.options('*', cors(corsOptions));

// Helper functions
function loadProducts() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      fs.writeFileSync(DATA_FILE, '[]');
      return [];
    }
    const data = fs.readFileSync(DATA_FILE, 'utf8');
    return JSON.parse(data);
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

// USUARIOS (mejorado con variables de entorno)
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

// Función de autenticación centralizada
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
    
    const user = users.find(u => 
      u.username === username && u.password === password
    );

    return user 
      ? { user } 
      : { error: 'Credenciales inválidas', status: 401 };
      
  } catch (error) {
    console.error('Error en autenticación:', error);
    return { error: 'Formato de autenticación inválido', status: 400 };
  }
}

// Middleware de autenticación
function authenticate(req, res, next) {
  const result = authenticateUser(req.headers.authorization);
  
  if (result.error) {
    return res.status(result.status).json({ error: result.error });
  }
  
  req.user = result.user;
  next();
}

// Endpoint de login mejorado
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

// RUTAS DE PRODUCTOS

// GET /api/products - Público (sin autenticación)
app.get('/api/products', (req, res) => {
  try {
    const products = loadProducts();
    res.json(products);
  } catch (error) {
    console.error('Error al obtener productos:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// POST /api/products - Protegido
app.post('/api/products', authenticate, (req, res) => {
    const MAX_PRODUCTS = 50;
    const currentProducts = loadProducts();
    if (currentProducts.length >= MAX_PRODUCTS) {
        return res.status(403).json({ 
            error: `Límite de ${MAX_PRODUCTS} productos alcanzado en la fase piloto.`,
            suggestion: "Contacte al administrador para ampliar la capacidad"
        });
    }
  const newProduct = req.body;
  
  // Validación mejorada
  if (!newProduct.nombre || typeof newProduct.nombre !== 'string') {
    return res.status(400).json({ error: 'Nombre es requerido y debe ser texto' });
  }
  
  // Convertir precio a número si viene como string
  if (typeof newProduct.precio === 'string') {
    newProduct.precio = parseFloat(newProduct.precio);
  }
  
  if (typeof newProduct.precio !== 'number' || isNaN(newProduct.precio) || newProduct.precio <= 0) {
    return res.status(400).json({ error: 'Precio debe ser un número positivo' });
  }

  try {
    const products = loadProducts();
    newProduct.id = Date.now().toString();
    products.push(newProduct);
    saveProducts(products);
    
    res.status(201).json(newProduct);
  } catch (error) {
    console.error('Error al crear producto:', error);
    res.status(500).json({ 
      error: 'Error al guardar el producto',
      details: error.message
    });
  }
});

// PUT /api/products/:id - Protegido
app.put('/api/products/:id', authenticate, (req, res) => {
  const productId = req.params.id;
  const updatedProduct = req.body;
  
  // Validación mejorada
  if (!updatedProduct.nombre || typeof updatedProduct.nombre !== 'string') {
    return res.status(400).json({ error: 'Nombre es requerido y debe ser texto' });
  }
  
  // Convertir precio a número si viene como string
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
    console.error('Error al actualizar producto:', error);
    res.status(500).json({ 
      error: 'Error al actualizar el producto',
      details: error.message
    });
  }
});

// DELETE /api/products/:id - Protegido
app.delete('/api/products/:id', authenticate, (req, res) => {
  const productId = req.params.id;
  
  try {
    const products = loadProducts();
    const initialLength = products.length;
    const newProducts = products.filter(p => p.id !== productId);
    
    if (newProducts.length === initialLength) {
      return res.status(404).json({ error: 'Producto no encontrado' });
    }
    
    saveProducts(newProducts);
    res.status(204).send();
  } catch (error) {
    console.error('Error al eliminar producto:', error);
    res.status(500).json({ 
      error: 'Error al eliminar el producto',
      details: error.message
    });
  }
});

// RUTAS ESTÁTICAS
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../index12.html'));
});

app.get('/admin/admin.html', (req, res) => {
  res.sendFile(path.join(__dirname, '../admin/admin.html'));
});

app.get('/admin/login.html', (req, res) => {
  res.sendFile(path.join(__dirname, '../admin/login.html'));
});

// Ruta de bienvenida API
app.get('/api', (req, res) => {
  res.send(`
    <style>
      body { font-family: Arial, sans-serif; margin: 40px; }
      a { color: #2ecc71; text-decoration: none; }
      a:hover { text-decoration: underline; }
    </style>
    <h1>API de MercadoVive</h1>
    <p>Endpoints disponibles:</p>
    <ul>
      <li>GET <a href="/api/products">/api/products</a> - Lista de productos (público)</li>
      <li>POST /api/products - Crear producto (requiere autenticación)</li>
      <li>PUT /api/products/:id - Actualizar producto (requiere autenticación)</li>
      <li>DELETE /api/products/:id - Eliminar producto (requiere autenticación)</li>
    </ul>
    <p>Panel de administración: <a href="/admin/admin.html">/admin/admin.html</a></p>
    <p>Frontend principal: <a href="/">/ (index12.html)</a></p>
  `);
});

// Middleware para manejar errores 404
app.use((req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada' });
});

// Middleware para manejar errores inesperados
app.use((err, req, res, next) => {
  console.error('Error no manejado:', err);
  res.status(500).json({ error: 'Error interno del servidor' });
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`✅ Servidor API activo en http://localhost:${PORT}`);
  
  // Crear archivo products.json si no existe
  if (!fs.existsSync(DATA_FILE)) {
    try {
      fs.writeFileSync(DATA_FILE, '[]');
      console.log('📄 Archivo products.json creado');
    } catch (err) {
      console.error('Error creando products.json:', err);
    }
  }
});