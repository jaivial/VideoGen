package handlers

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
	"video-generator/internal/db"
	"video-generator/internal/models"
	"video-generator/internal/services"
)

type AuthHandler struct {
	db      *db.DB
	email   *services.EmailService
}

func NewAuthHandler(database *db.DB, email *services.EmailService) *AuthHandler {
	return &AuthHandler{
		db:    database,
		email: email,
	}
}

func (h *AuthHandler) Register(w http.ResponseWriter, r *http.Request) {
	var req models.RegisterRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	// Validate input
	if req.Name == "" || req.Email == "" || req.Password == "" {
		http.Error(w, "Name, email and password are required", http.StatusBadRequest)
		return
	}

	if len(req.Password) < 8 {
		http.Error(w, "Password must be at least 8 characters", http.StatusBadRequest)
		return
	}

	// Check if user exists
	var exists bool
	err := h.db.Get(&exists, "SELECT EXISTS(SELECT 1 FROM users WHERE email = ?)", req.Email)
	if err != nil {
		http.Error(w, "Database error", http.StatusInternalServerError)
		return
	}
	if exists {
		http.Error(w, "Email already registered", http.StatusConflict)
		return
	}

	// Hash password
	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		http.Error(w, "Failed to hash password", http.StatusInternalServerError)
		return
	}

	// Insert user
	result, err := h.db.Exec(
		"INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)",
		req.Name, req.Email, string(hash),
	)
	if err != nil {
		http.Error(w, "Failed to create user", http.StatusInternalServerError)
		return
	}

	userID, _ := result.LastInsertId()

	// Create verification record
	token := uuid.New().String()
	expiration := time.Now().Add(24 * time.Hour)

	_, err = h.db.Exec(
		"INSERT INTO email_verification (user_id, token, token_expiration_date) VALUES (?, ?, ?)",
		userID, token, expiration,
	)
	if err != nil {
		http.Error(w, "Failed to create verification", http.StatusInternalServerError)
		return
	}

	// Create verified state record
	_, err = h.db.Exec(
		"INSERT INTO users_verified (user_id, verified_state) VALUES (?, FALSE)",
		userID,
	)
	if err != nil {
		http.Error(w, "Failed to create verified state", http.StatusInternalServerError)
		return
	}

	// Send verification email
	go h.email.SendVerificationEmail(req.Email, token)

	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]string{
		"message": "Registration successful. Please check your email to verify your account.",
	})
}

func (h *AuthHandler) Login(w http.ResponseWriter, r *http.Request) {
	var req models.LoginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	// Find user
	var user models.User
	err := h.db.Get(&user, "SELECT * FROM users WHERE email = ?", req.Email)
	if err == sql.ErrNoRows {
		http.Error(w, "Invalid email or password", http.StatusUnauthorized)
		return
	}
	if err != nil {
		http.Error(w, "Database error", http.StatusInternalServerError)
		return
	}

	// Check if user is verified
	var verified models.UserVerified
	err = h.db.Get(&verified, "SELECT * FROM users_verified WHERE user_id = ?", user.ID)
	if err != nil || !verified.VerifiedState {
		http.Error(w, "Please verify your email first", http.StatusUnauthorized)
		return
	}

	// Verify password
	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(req.Password)); err != nil {
		http.Error(w, "Invalid email or password", http.StatusUnauthorized)
		return
	}

	// Create session
	sessionID := generateSessionID()
	expiration := time.Now().Add(7 * 24 * time.Hour)

	_, err = h.db.Exec(
		"INSERT INTO user_session (user_id, session_id, expiration_date) VALUES (?, ?, ?)",
		user.ID, sessionID, expiration,
	)
	if err != nil {
		http.Error(w, "Failed to create session", http.StatusInternalServerError)
		return
	}

	// Set cookie
	http.SetCookie(w, &http.Cookie{
		Name:     "session_id",
		Value:    sessionID,
		Path:     "/",
		Expires:  expiration,
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
	})

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"message": "Login successful",
		"user": map[string]interface{}{
			"id":    user.ID,
			"name":  user.Name,
			"email": user.Email,
		},
	})
}

func (h *AuthHandler) Logout(w http.ResponseWriter, r *http.Request) {
	cookie, err := r.Cookie("session_id")
	if err == nil {
		h.db.Exec("DELETE FROM user_session WHERE session_id = ?", cookie.Value)
	}

	http.SetCookie(w, &http.Cookie{
		Name:   "session_id",
		Value:  "",
		Path:   "/",
		MaxAge: -1,
	})

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"message": "Logged out"})
}

func (h *AuthHandler) Verify(w http.ResponseWriter, r *http.Request) {
	token := r.URL.Query().Get("token")
	if token == "" {
		http.Error(w, "Token required", http.StatusBadRequest)
		return
	}

	// Find verification record
	var verification models.EmailVerification
	err := h.db.Get(&verification, "SELECT * FROM email_verification WHERE token = ?", token)
	if err == sql.ErrNoRows {
		http.Error(w, "Invalid token", http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, "Database error", http.StatusInternalServerError)
		return
	}

	if verification.TokenUsed {
		http.Error(w, "Token already used", http.StatusBadRequest)
		return
	}

	if time.Now().After(verification.TokenExpirationDate) {
		http.Error(w, "Token expired", http.StatusBadRequest)
		return
	}

	// Mark token as used
	h.db.Exec("UPDATE email_verification SET token_used = TRUE WHERE id = ?", verification.ID)

	// Mark user as verified
	h.db.Exec("UPDATE users_verified SET verified_state = TRUE WHERE user_id = ?", verification.UserID)

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"message": "Email verified successfully"})
}

func (h *AuthHandler) Me(w http.ResponseWriter, r *http.Request) {
	sessionID := r.Header.Get("X-Session-ID")
	if sessionID == "" {
		http.Error(w, "Not authenticated", http.StatusUnauthorized)
		return
	}

	var session models.UserSession
	err := h.db.Get(&session, "SELECT * FROM user_session WHERE session_id = ?", sessionID)
	if err == sql.ErrNoRows {
		http.Error(w, "Invalid session", http.StatusUnauthorized)
		return
	}
	if err != nil {
		http.Error(w, "Database error", http.StatusInternalServerError)
		return
	}

	if time.Now().After(session.ExpirationDate) {
		http.Error(w, "Session expired", http.StatusUnauthorized)
		return
	}

	var user models.User
	err = h.db.Get(&user, "SELECT id, name, email, created_at FROM users WHERE id = ?", session.UserID)
	if err != nil {
		http.Error(w, "User not found", http.StatusNotFound)
		return
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(user)
}

func (h *AuthHandler) GetSessionUser(w http.ResponseWriter, r *http.Request) (uint64, error) {
	cookie, err := r.Cookie("session_id")
	if err != nil {
		return 0, fmt.Errorf("no session")
	}

	sessionID := cookie.Value

	var session models.UserSession
	err = h.db.Get(&session, "SELECT * FROM user_session WHERE session_id = ?", sessionID)
	if err == sql.ErrNoRows {
		return 0, fmt.Errorf("invalid session")
	}
	if err != nil {
		return 0, fmt.Errorf("database error")
	}

	if time.Now().After(session.ExpirationDate) {
		return 0, fmt.Errorf("session expired")
	}

	return session.UserID, nil
}

func generateSessionID() string {
	b := make([]byte, 32)
	rand.Read(b)
	return hex.EncodeToString(b)
}
