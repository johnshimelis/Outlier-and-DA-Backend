require("dotenv").config();
const User = require("../models/Users");
const UserOrder = require("../models/UserOrder");
const Message = require("../models/Message");
const Notification = require("../models/Notification");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const nodemailer = require("nodemailer");
const { parsePhoneNumber } = require('libphonenumber-js'); // More robust phone parsing

// Email sending function (unchanged)
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

// Enhanced phone validation with country code support
const validatePhoneNumber = (phoneNumber) => {
  if (!phoneNumber) throw new Error("Phone number is required");

  try {
    const parsedNumber = parsePhoneNumber(phoneNumber.toString());
    
    if (!parsedNumber || !parsedNumber.isValid()) {
      throw new Error("Invalid international phone number format");
    }

    // Get the national number (without country code)
    const nationalNumber = parsedNumber.nationalNumber;
    
    // Validate local number length (9-10 digits)
    if (nationalNumber.length < 9 || nationalNumber.length > 10) {
      throw new Error("Local phone number must be 9-10 digits (after country code)");
    }

    // Return in E.164 format (+[country code][number])
    return parsedNumber.format('E.164');
  } catch (error) {
    throw new Error(`Please provide a valid international phone number (e.g., +251912345678 or +11234567890). ${error.message}`);
  }
};

// Email validation (unchanged)
const validateEmail = (email) => {
  if (!email) throw new Error("Email is required");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Invalid email format (e.g., user@example.com)");
  }
};

// Password validation (unchanged)
const validatePassword = (password) => {
  if (!password) throw new Error("Password is required");
  if (password.length < 8) {
    throw new Error("Password must be at least 8 characters");
  }
};

// Registration function with enhanced phone support
const registerUser = async (req, res) => {
  const { fullName, phoneNumber, email, password } = req.body;

  try {
    // Validate inputs
    if (!fullName) throw new Error("Full name is required");
    
    const validatedPhone = validatePhoneNumber(phoneNumber);
    validateEmail(email);
    validatePassword(password);

    // Check if user exists (parallel queries)
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

    const hashedPassword = await bcrypt.hash(password, 12); // Stronger hashing

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
        id: newUser._id,
        fullName: newUser.fullName,
        phoneNumber: newUser.phoneNumber,
        email: newUser.email
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

// Login function (unchanged)
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

    const otp = Math.floor(100000 + Math.random() * 900000);
    const otpExpiry = Date.now() + 10 * 60 * 1000; // 10 minutes

    user.otp = otp;
    user.otpExpiry = otpExpiry;
    await user.save();

    await sendOTP(email, otp);

    res.status(200).json({ 
      success: true,
      message: "OTP sent to your email",
      email: email
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

// OTP Verification function (unchanged)
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

    if (Date.now() > user.otpExpiry) {
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

    // Fetch user data in parallel
    const [orders, messages, notifications] = await Promise.all([
      UserOrder.find({ userId: user._id }).select('date status total'),
      Message.find({ userId: user._id }).select('from message read date'),
      Notification.find({ userId: user._id }).select('message date')
    ]);

    // Clear OTP
    user.otp = undefined;
    user.otpExpiry = undefined;
    await user.save();

    res.status(200).json({
      success: true,
      message: "Login successful",
      token,
      user: {
        id: user._id,
        fullName: user.fullName,
        phoneNumber: user.phoneNumber,
        email: user.email,
        orders,
        messages,
        notifications,
      },
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
