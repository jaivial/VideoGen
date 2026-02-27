package main

import (
	"flag"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/joho/godotenv"
	"video-generator/internal/config"
	"video-generator/internal/db"
	"video-generator/internal/handlers"
	"video-generator/internal/services"
	"video-generator/internal/worker"
)

func main() {
	flag.Parse()

	// Load .env file from project root if exists
	godotenv.Load("/root/video-generator/.env")

	cfg := config.Load()

	// Initialize database
	database, err := db.NewConnection(cfg.DBHost, cfg.DBPort, cfg.DBUser, cfg.DBPassword, cfg.DBName)
	if err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}
	defer database.Close()

	log.Println("Connected to database")

	// Create temp directory
	tempDir := "/tmp/video_generator"
	if err := os.MkdirAll(tempDir, 0755); err != nil {
		log.Fatalf("Failed to create temp directory: %v", err)
	}

	// Initialize services
	emailService := services.NewEmailService(cfg)
	ytService := services.NewYouTubeService(tempDir)
	waveSpeedService := services.NewWaveSpeedService(cfg)
	openRouterService := services.NewOpenRouterService(cfg)
	bunnyService := services.NewBunnyService(cfg)
	videoProcessor := services.NewVideoProcessor(tempDir, cfg)

	// Initialize handlers
	wsHandler := handlers.NewWebSocketHandler()
	authHandler := handlers.NewAuthHandler(database, emailService)
	videoWorker := worker.NewVideoWorker(
		database, ytService, waveSpeedService, openRouterService,
		bunnyService, videoProcessor, wsHandler, tempDir, cfg,
	)
	videoHandler := handlers.NewVideoHandler(database, videoWorker, authHandler, ytService)
	editorHandler := handlers.NewEditorHandler(database, bunnyService, authHandler)

	// Start cleanup goroutine
	go func() {
		ticker := time.NewTicker(1 * time.Hour)
		defer ticker.Stop()
		for range ticker.C {
			videoWorker.CleanupExpiredVideos()
		}
	}()

	// Setup router
	r := chi.NewRouter()

	// Middleware
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(middleware.Timeout(60 * time.Second))

	// CORS
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			origin := r.Header.Get("Origin")
			// Allow specific origins or use the request origin
			if origin != "" {
				w.Header().Set("Access-Control-Allow-Origin", origin)
			} else {
				w.Header().Set("Access-Control-Allow-Origin", "*")
			}
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, Cookie")
			w.Header().Set("Access-Control-Allow-Credentials", "true")

			if r.Method == "OPTIONS" {
				w.WriteHeader(http.StatusOK)
				return
			}

			next.ServeHTTP(w, r)
		})
	})

	// Public routes
	r.Post("/api/auth/register", authHandler.Register)
	r.Post("/api/auth/login", authHandler.Login)
	r.Post("/api/auth/logout", authHandler.Logout)
	r.Get("/api/auth/verify", authHandler.Verify)

	// Protected routes
	r.Group(func(r chi.Router) {
		r.Use(func(next http.Handler) http.Handler {
			return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				cookie, err := r.Cookie("session_id")
				if err != nil {
					http.Error(w, "Unauthorized", http.StatusUnauthorized)
					return
				}
				r.Header.Set("X-Session-ID", cookie.Value)
				next.ServeHTTP(w, r)
			})
		})

		r.Get("/api/auth/me", authHandler.Me)
		r.Post("/api/video/generate", videoHandler.Generate)
		r.Get("/api/video/status", videoHandler.Status)
		r.Get("/api/video/list", videoHandler.List)
		r.Post("/api/video/mark-downloaded", videoHandler.MarkDownloaded)
		r.Get("/api/video/languages", videoHandler.GetLanguages)
		r.Get("/api/video/transcript", videoHandler.GetTranscript)
		r.Get("/api/video/transcript/languages", videoHandler.GetAvailableTranscriptLanguages)

		// Editor routes
		r.Post("/api/editor/upload-media", editorHandler.UploadMedia)
		r.Post("/api/editor/video/{id}/process", editorHandler.ProcessVideo)
		r.Get("/api/editor/video/{id}/assets", editorHandler.GetVideoAssets)
	})

	// WebSocket
	r.Get("/ws/video/{id}", func(w http.ResponseWriter, r *http.Request) {
		// Upgrade to WebSocket
		wsHandler.ServeHTTP(w, r)
	})

	// Serve static files in production
	// r.Handle("/dist/*", http.FileServer(http.Dir("./frontend/dist")))

	// Start server
	addr := "0.0.0.0:8080"
	log.Printf("Starting server on %s", addr)

	srv := &http.Server{
		Addr:         addr,
		Handler:      r,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 30 * time.Second,
	}

	go func() {
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Failed to start server: %v", err)
		}
	}()

	// Graceful shutdown
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	log.Println("Shutting down server...")
}
