require("dotenv").config();
const User = require("../models/Users");
const UserOrder = require("../models/UserOrder");
const Message = require("../models/Message");
const Notification = require("../models/Notification");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const nodemailer = require("nodemailer");

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

const validatePhoneNumber = (phoneNumber) => {
  // Remove any non-digit characters
  const cleaned = phoneNumber.replace(/\D/g, '');
  
  // Check if phone number is 9 or 10 digits
  if (!/^[0-9]{9,10}$/.test(cleaned)) {
    throw new Error("Phone number must be 9 or 10 digits");
  }
  
  return cleaned;
};

const validateEmail = (email) => {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Invalid email format");
  }
};

const validatePassword = (password) => {
  if (password.length < 8) {
    throw new Error("Password must be at least 8 characters");
  }
};

const registerUser = async (req, res) => {
  const { fullName, phoneNumber, email, password } = req.body;

  try {
    // Validate inputs
    if (!fullName) throw new Error("Full name is required");
    if (!phoneNumber) throw new Error("Phone number is required");
    if (!email) throw new Error("Email is required");
    if (!password) throw new Error("Password is required");

    const validatedPhone = validatePhoneNumber(phoneNumber);
    validateEmail(email);
    validatePassword(password);

    // Check if user exists
    const userExists = await User.findOne({ email });
    if (userExists) {
      return res.status(400).json({ 
        success: false,
        message: "User already exists with this email" 
      });
    }

    const phoneExists = await User.findOne({ phoneNumber: validatedPhone });
    if (phoneExists) {
      return res.status(400).json({ 
        success: false,
        message: "User already exists with this phone number" 
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
      message: "User registered successfully" 
    });
  } catch (error) {
    console.error("Error registering user:", error);
    res.status(400).json({ 
      success: false,
      message: error.message || "Registration failed" 
    });
  }
};

const loginUser = async (req, res) => {
  const { email } = req.body;

  try {
    if (!email) throw new Error("Email is required");
    validateEmail(email);

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ 
        success: false,
        message: "User not found. Please register first." 
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
      message: "OTP sent to your email" 
    });
  } catch (error) {
    console.error("Error logging in user:", error);
    res.status(400).json({ 
      success: false,
      message: error.message || "Login failed" 
    });
  }
};

const verifyOTP = async (req, res) => {
  const { email, otp } = req.body;

  try {
    if (!email) throw new Error("Email is required");
    if (!otp) throw new Error("OTP is required");
    validateEmail(email);

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ 
        success: false,
        message: "User not found" 
      });
    }

    if (user.otp !== otp) {
      return res.status(400).json({ 
        success: false,
        message: "Invalid OTP code" 
      });
    }

    if (Date.now() > user.otpExpiry) {
      return res.status(400).json({ 
        success: false,
        message: "OTP has expired. Please request a new one." 
      });
    }

    // Generate JWT token
    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, {
      expiresIn: "365d",
    });

    // Fetch user data
    const [orders, messages, notifications] = await Promise.all([
      UserOrder.find({ userId: user._id }).select('date status total'),
      Message.find({ userId: user._id }).select('from message read date'),
      Notification.find({ userId: user._id }).select('message date')
    ]);

    // Clear OTP after successful verification
    user.otp = undefined;
    user.otpExpiry = undefined;
    await user.save();

    res.status(200).json({
      success: true,
      message: "Login successful",
      token,
      user: {
        userId: user._id,
        fullName: user.fullName,
        phoneNumber: user.phoneNumber,
        email: user.email,
        orders,
        messages,
        notifications,
      },
    });
  } catch (error) {
    console.error("Error verifying OTP:", error);
    res.status(400).json({ 
      success: false,
      message: error.message || "OTP verification failed" 
    });
  }
};

module.exports = {
  registerUser,
  loginUser,
  verifyOTP,
};
