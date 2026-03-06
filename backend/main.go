package main

import (
	"flag"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"video-generator/internal/config"
	"video-generator/internal/db"
	"video-generator/internal/handlers"
	"video-generator/internal/services"
	"video-generator/internal/worker"
)

func main() {
	flag.Parse()

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
	editorUploadsDir := filepath.Join(tempDir, "editor_uploads")
	if err := os.MkdirAll(editorUploadsDir, 0755); err != nil {
		log.Fatalf("Failed to create editor uploads directory: %v", err)
	}

	// Initialize services
	emailService := services.NewEmailService(cfg)
	ytService := services.NewYouTubeService(tempDir)
	waveSpeedService := services.NewWaveSpeedService(cfg)
	openRouterService := services.NewOpenRouterService(cfg)
	bunnyService := services.NewBunnyService(cfg)
	videoProcessor := services.NewVideoProcessor(tempDir, cfg)
	editorRenderer := services.NewEditorRenderService(tempDir, cfg)

	// Initialize handlers
	wsHandler := handlers.NewWebSocketHandler()
	authHandler := handlers.NewAuthHandler(database, emailService)
	videoWorker := worker.NewVideoWorker(
		database, ytService, waveSpeedService, openRouterService,
		bunnyService, videoProcessor, wsHandler, tempDir, cfg,
	)
	videoHandler := handlers.NewVideoHandler(database, videoWorker, authHandler, ytService)
	editorHandler := handlers.NewEditorHandler(database, bunnyService, authHandler, editorRenderer, tempDir)

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
			w.Header().Set("Vary", "Origin")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Accept, Content-Type, Authorization, X-Requested-With, X-Session-ID")
			w.Header().Set("Access-Control-Allow-Credentials", "true")
			w.Header().Set("Access-Control-Max-Age", "86400")

			if r.Method == "OPTIONS" {
				w.WriteHeader(http.StatusNoContent)
				return
			}

			next.ServeHTTP(w, r)
		})
	})

	api := chi.NewRouter()
	api.Use(middleware.Timeout(60 * time.Second))
	api.Options("/*", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})

	// Public routes
	api.Post("/auth/register", authHandler.Register)
	api.Post("/auth/login", authHandler.Login)
	api.Post("/auth/logout", authHandler.Logout)
	api.Get("/auth/verify", authHandler.Verify)

	// Protected routes
	api.Group(func(r chi.Router) {
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

		r.Get("/auth/me", authHandler.Me)
		r.Post("/video/generate", videoHandler.Generate)
		r.Post("/video/extract-document", videoHandler.ExtractDocument)
		r.Get("/video/status", videoHandler.Status)
		r.Get("/video/list", videoHandler.List)
		r.Post("/video/mark-downloaded", videoHandler.MarkDownloaded)
		r.Get("/video/languages", videoHandler.GetLanguages)
		r.Get("/video/transcript", videoHandler.GetTranscript)
		r.Get("/video/transcript/languages", videoHandler.GetAvailableTranscriptLanguages)

		// Editor routes
		r.Post("/editor/upload-media", editorHandler.UploadMedia)
		r.Post("/editor/video/{id}/process", editorHandler.ProcessVideo)
		r.Get("/editor/video/{id}/assets", editorHandler.GetVideoAssets)
		r.Post("/editor/project/save", editorHandler.SaveProject)
		r.Get("/editor/projects", editorHandler.ListProjects)
		r.Get("/editor/project/{id}", editorHandler.LoadProject)
		// Rendering can take longer than typical API calls.
		r.With(middleware.Timeout(10*time.Minute)).Post("/editor/video/{id}/render", editorHandler.RenderVideo)
	})

	r.Mount("/api", api)
	r.Options("/*", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})
	r.Handle("/media/editor/*", http.StripPrefix("/media/editor/", http.FileServer(http.Dir(editorUploadsDir))))

	// WebSocket
	r.Get("/ws/video/{id}", func(w http.ResponseWriter, r *http.Request) {
		// Upgrade to WebSocket
		wsHandler.ServeHTTP(w, r)
	})

	// Editor collaboration WebSocket
	r.Get("/ws/editor/{projectId}", func(w http.ResponseWriter, r *http.Request) {
		wsHandler.ServeEditorHTTP(w, r)
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
