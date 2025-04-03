const express = require("express");
const router = express.Router();
const adsController = require("../controllers/adsController");

// Routes
router.post("/:type", adsController.uploadAd);
router.get("/:type", adsController.getAds);
router.delete("/:id", adsController.deleteAd);
router.put("/:id", adsController.updateAd);

module.exports = router;
