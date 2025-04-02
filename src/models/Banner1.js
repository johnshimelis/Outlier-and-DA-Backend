const mongoose = require("mongoose");

const banner1Schema = new mongoose.Schema({
  images: { type: [String], required: true },
});

module.exports = mongoose.model("Banner1", banner1Schema);
