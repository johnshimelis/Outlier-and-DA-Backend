const path = require("path");
const multer = require("multer");

// Configure storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/");
  },
  filename: (req, file, cb) => {
    const uniqueName = Date.now() + path.extname(file.originalname);
    cb(null, uniqueName);
  }
});

// Allow only images & handle empty file cases
const fileFilter = (req, file, cb) => {
  if (!file) {
    return cb(null, false); // No file provided (handle gracefully)
  }

  const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/avif"];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error("❌ Invalid file type. Only JPG, PNG, WEBP, and AVIF allowed."), false);
  }
};

// Define upload limits (e.g., max file size: 5MB)
const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
});

// Middleware to handle single file upload
const uploadImage = (req, res, next) => {
  upload.single("image")(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      return res.status(400).json({ error: `❌ Multer error: ${err.message}` });
    } else if (err) {
      return res.status(400).json({ error: `❌ File upload error: ${err.message}` });
    }
    next();
  });
};

module.exports = { uploadImage };
