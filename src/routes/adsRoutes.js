const express = require("express");
const router = express.Router();
const adsController = require("../controllers/adsController");

// Routes
router.post("/:type", adsController.uploadAd); // Multer middleware is already included in the controller
router.get("/:type", adsController.getAds);
router.delete("/:id", adsController.deleteAd);
router.put("/:id", adsController.updateAd); // Multer middleware is already included in the controller

module.exports = router;
