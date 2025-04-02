const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  fullName: { type: String, required: true },
  phoneNumber: { type: String, required: true, unique: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  otp: String, // Store OTP for login validation
  otpExpiry: Date, // Store OTP expiry time
});

module.exports = mongoose.model("User", userSchema);
