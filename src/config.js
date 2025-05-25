"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = void 0;
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config(); // используется для загрузки переменных среды из файла .env и их добавления в объект process.env в приложении Node.js
exports.config = {
    PORT: process.env.PORT || 3000,
    EMAIL_USER: process.env.EMAIL_USER || 'your.email@gmail.com',
    EMAIL_PASS: process.env.EMAIL_PASS || 'your-email-password',
    EMAIL_TO: process.env.EMAIL_TO || 'business.owner@example.com',
    EMAIL_SUBJECT: 'Новый запрос обратной связи',
};
