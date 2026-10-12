/**
 * dom.js — referencias a los elementos del DOM.
 *
 * Requiere que el HTML ya esté parseado (los <script> van al final de <body>).
 * Script clásico (sin módulos ES): comparte el ámbito global con los demás
 * archivos de js/ y depende del ORDEN de carga definido en widget.html.
 */

// Refs del DOM
const chatInput = document.getElementById("chatInput");
const sendBtn = document.getElementById("sendBtn");
const chatContainer = document.getElementById("chatContainer");
const welcomeScreen = document.getElementById("welcomeScreen");
const messageList = document.getElementById("messageList");
const sidebar = document.getElementById("sidebar");
const conversationList = document.getElementById("conversationList");
const newChatBtn = document.getElementById("newChatBtn");
const toggleSidebarBtn = document.getElementById("toggleSidebarBtn");
const backdrop = document.getElementById("backdrop");
const exportBtn = document.getElementById("exportBtn");
const importBtn = document.getElementById("importBtn");
const importInput = document.getElementById("importInput");
const toast = document.getElementById("toast");
