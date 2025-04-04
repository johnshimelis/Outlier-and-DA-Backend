require("dotenv").config();
const User = require("../models/Users");
const UserOrder = require("../models/UserOrder");
const Message = require("../models/Message");
const Notification = require("../models/Notification");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const nodemailer = require("nodemailer");

// Email sending function
const sendOTP = async (email, otp) => {
  const transporter = nodemailer.createTransport({
    service: process.env.EMAIL_SERVICE || 'gmail',
    host: process.env.EMAIL_HOST || "smtp.gmail.com",
    port: process.env.EMAIL_PORT || 465,
    secure: true,
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });

  const mailOptions = {
    from: `"PA Gebeya" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: "Your Login OTP Code",
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #333;">Your One-Time Password (OTP)</h2>
        <p>Use the following OTP to complete your login:</p>
        <div style="background: #f4f4f4; padding: 20px; text-align: center; margin: 20px 0;">
          <h1 style="margin: 0; color: #0066cc;">${otp}</h1>
        </div>
        <p>This OTP is valid for 10 minutes.</p>
        <p>If you didn't request this, please ignore this email.</p>
      </div>
    `,
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`OTP sent to ${email}`);
    return true;
  } catch (error) {
    console.error("Error sending OTP email:", error);
    throw new Error("Failed to send OTP email");
  }
};

// Phone validation (simplified for your example format)
const validatePhoneNumber = (phoneNumber) => {
  if (!phoneNumber) throw new Error("Phone number is required");
  
  // Remove all non-digit characters
  const cleaned = phoneNumber.toString().replace(/\D/g, '');
  
  // Check if phone number is 10 digits (for Ethiopian format)
  if (!/^[0-9]{10}$/.test(cleaned)) {
    throw new Error("Phone number must be 10 digits (e.g., 0967432143)");
  }
  
  return cleaned;
};

// Email validation
const validateEmail = (email) => {
  if (!email) throw new Error("Email is required");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Invalid email format (e.g., user@example.com)");
  }
};

// Password validation
const validatePassword = (password) => {
  if (!password) throw new Error("Password is required");
  if (password.length < 8) {
    throw new Error("Password must be at least 8 characters");
  }
};

// Registration function
const registerUser = async (req, res) => {
  const { fullName, phoneNumber, email, password } = req.body;

  try {
    // Validate inputs
    if (!fullName) throw new Error("Full name is required");
    
    const validatedPhone = validatePhoneNumber(phoneNumber);
    validateEmail(email);
    validatePassword(password);

    // Check if user exists
    const [userExists, phoneExists] = await Promise.all([
      User.findOne({ email }),
      User.findOne({ phoneNumber: validatedPhone })
    ]);

    if (userExists) {
      return res.status(400).json({ 
        success: false,
        message: "User already exists with this email",
        code: "EMAIL_EXISTS"
      });
    }

    if (phoneExists) {
      return res.status(400).json({ 
        success: false,
        message: "User already exists with this phone number",
        code: "PHONE_EXISTS"
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = new User({
      fullName,
      phoneNumber: validatedPhone,
      email,
      password: hashedPassword,
    });

    await newUser.save();

    res.status(201).json({ 
      success: true,
      message: "User registered successfully",
      user: {
        _id: newUser._id,
        fullName: newUser.fullName,
        phoneNumber: newUser.phoneNumber,
        email: newUser.email,
        password: newUser.password, // Only for demonstration, remove in production
        __v: newUser.__v
      }
    });
  } catch (error) {
    console.error("Registration error:", error);
    res.status(400).json({ 
      success: false,
      message: error.message || "Registration failed",
      code: "VALIDATION_ERROR",
      error: error.message
    });
  }
};

// Login function
const loginUser = async (req, res) => {
  const { email } = req.body;

  try {
    if (!email) throw new Error("Email is required");
    validateEmail(email);

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ 
        success: false,
        message: "Account not found. Please register first.",
        code: "USER_NOT_FOUND"
      });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes from now

    // Update user with OTP details
    const updatedUser = await User.findByIdAndUpdate(
      user._id,
      { 
        $set: { 
          otp: otp,
          otpExpiry: otpExpiry 
        } 
      },
      { new: true }
    );

    await sendOTP(email, otp);

    res.status(200).json({ 
      success: true,
      message: "OTP sent to your email",
      email: email,
      otpDetails: {
        otp: updatedUser.otp,
        otpExpiry: updatedUser.otpExpiry
      }
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(400).json({ 
      success: false,
      message: error.message || "Login failed",
      code: "LOGIN_ERROR"
    });
  }
};

// OTP Verification function
const verifyOTP = async (req, res) => {
  const { email, otp } = req.body;

  try {
    if (!email) throw new Error("Email is required");
    if (!otp) throw new Error("OTP is required");
    validateEmail(email);

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ 
        success: false,
        message: "User not found",
        code: "USER_NOT_FOUND"
      });
    }

    if (user.otp !== otp) {
      return res.status(400).json({ 
        success: false,
        message: "Invalid OTP code",
        code: "INVALID_OTP"
      });
    }

    if (new Date() > new Date(user.otpExpiry)) {
      return res.status(400).json({ 
        success: false,
        message: "OTP expired. Please request a new one.",
        code: "OTP_EXPIRED"
      });
    }

    // Generate JWT token
    const token = jwt.sign(
      { userId: user._id }, 
      process.env.JWT_SECRET,
      { expiresIn: "365d" }
    );

    // Clear OTP fields after successful verification
    user.otp = undefined;
    user.otpExpiry = undefined;
    await user.save();

    res.status(200).json({
      success: true,
      message: "Login successful",
      token,
      user: {
        _id: user._id,
        fullName: user.fullName,
        phoneNumber: user.phoneNumber,
        email: user.email,
        __v: user.__v
      }
    });
  } catch (error) {
    console.error("OTP verification error:", error);
    res.status(400).json({ 
      success: false,
      message: error.message || "OTP verification failed",
      code: "OTP_ERROR"
    });
  }
};

module.exports = {
  registerUser,
  loginUser,
  verifyOTP,
};