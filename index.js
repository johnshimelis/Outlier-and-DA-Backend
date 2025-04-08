const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const path = require("path");
require("dotenv").config();

const app = express();

// Allowed origins
const allowedOrigins = [
  "https://sprightly-sawine-43e5c3.netlify.app",
  "https://chimerical-lebkuchen-58351a.netlify.app",
  "http://localhost:3000", 
  "http://localhost:3001", 
  "http://localhost:3002", 
  "https://pgebeyaadmin.netlify.app",
  "https://pgebeya.netlify.app",
  "https://daandoutlierservice.netlify.app",
  
];

// Middleware
app.use(express.json());
app.use(
  cors({
    origin: allowedOrigins, // Allow both Netlify frontends and localhost
    credentials: true, // Allow cookies and authentication headers
    methods: ["GET", "POST", "PUT", "DELETE"], // Allowed HTTP methods
    allowedHeaders: ["Content-Type", "Authorization"], // Allowed headers
  })
);

// Manually set CORS headers for all responses
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.header("Access-Control-Allow-Origin", origin);
  }
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.header("Access-Control-Allow-Credentials", "true");
  next();
});

app.use("/uploads", express.static(path.join(__dirname, "uploads")));

app.use(express.urlencoded({ extended: true })); // Parses URL-encoded form data

// Connect to MongoDB
const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/pa-gebeya";
mongoose
  .connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log("✅ MongoDB Connected"))
  .catch((err) => console.error("❌ MongoDB Connection Error:", err));

app.get("/", (req, res) => {
  res.send("Welcome to PA-Gebeya API 🚀");
});

// Import Routes
const authRoutes = require("./src/routes/authRoutes");
app.use("/api/auth", authRoutes);

const categoryRoutes = require("./src/routes/categoryRoutes");
app.use("/api/categories", categoryRoutes);

const productRoutes = require("./src/routes/productRoutes");
app.use("/api/products", productRoutes);

const orderRoutes = require("./src/routes/orderRoutes");
app.use("/api/orders", orderRoutes);

const cartRoutes = require("./src/routes/cartRoutes");
app.use("/api/cart", cartRoutes);

const userRoute = require("./src/routes/userRoutes");
app.use("/api/users", userRoute);

const adsRoutes = require("./src/routes/adsRoutes");
app.use("/api/ads", adsRoutes);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));