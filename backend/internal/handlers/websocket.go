package handlers

import (
	"encoding/json"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

// WSMessage represents a WebSocket message with extended fields for granular progress
type WSMessage struct {
	Type          string      `json:"type"`
	VideoID       uint64      `json:"video_id,omitempty"`
	Timestamp     string      `json:"timestamp,omitempty"`
	Phase         string      `json:"phase,omitempty"`
	Step          string      `json:"step,omitempty"`
	Progress      int         `json:"progress,omitempty"`
	Message       string      `json:"message,omitempty"`
	Error         string      `json:"error,omitempty"`
	Details       interface{} `json:"details,omitempty"`
	Payload       interface{} `json:"payload,omitempty"`
	ElementIndex  int         `json:"element_index,omitempty"`
	ElementTotal  int         `json:"element_total,omitempty"`
	ElementStatus string      `json:"element_status,omitempty"`
}

// WebSocketHandler manages WebSocket connections for video progress updates
type WebSocketHandler struct {
	clients    map[uint64]*websocket.Conn
	clientsMux sync.RWMutex
	allClients map[*websocket.Conn]bool
	allClientsMux sync.RWMutex
	upgrader   websocket.Upgrader
}

func NewWebSocketHandler() *WebSocketHandler {
	return &WebSocketHandler{
		clients:    make(map[uint64]*websocket.Conn),
		allClients: make(map[*websocket.Conn]bool),
		upgrader: websocket.Upgrader{
			CheckOrigin: func(r *http.Request) bool {
				return true // Allow all origins in dev
			},
		},
	}
}

func (h *WebSocketHandler) HandleVideoProgress(videoID uint64) {
	h.clientsMux.RLock()
	conn, exists := h.clients[videoID]
	h.clientsMux.RUnlock()

	if !exists || conn == nil {
		return
	}

	// Connection already registered for this video
}

func (h *WebSocketHandler) RegisterConnection(videoID uint64, conn *websocket.Conn) {
	h.clientsMux.Lock()
	h.clients[videoID] = conn
	h.clientsMux.Unlock()

	// Also register in all clients for logs broadcasting
	h.allClientsMux.Lock()
	h.allClients[conn] = true
	h.allClientsMux.Unlock()
}

func (h *WebSocketHandler) UnregisterConnection(videoID uint64) {
	h.clientsMux.Lock()
	conn, exists := h.clients[videoID]
	if exists {
		delete(h.clients, videoID)
	}
	h.clientsMux.Unlock()

	// Remove from all clients
	if conn != nil {
		h.allClientsMux.Lock()
		delete(h.allClients, conn)
		h.allClientsMux.Unlock()
	}
}

// BroadcastToAll sends a message to ALL connected clients (for logs page)
func (h *WebSocketHandler) BroadcastToAll(msg WSMessage) {
	data, err := json.Marshal(msg)
	if err != nil {
		log.Printf("Failed to marshal WS message: %v", err)
		return
	}

	h.allClientsMux.RLock()
	defer h.allClientsMux.RUnlock()

	for conn := range h.allClients {
		if err := conn.WriteMessage(websocket.TextMessage, data); err != nil {
			log.Printf("Failed to write WS message to client: %v", err)
			conn.Close()
			delete(h.allClients, conn)
		}
	}
}

func (h *WebSocketHandler) SendToVideo(videoID uint64, msg WSMessage) {
	h.clientsMux.RLock()
	conn, exists := h.clients[videoID]
	h.clientsMux.RUnlock()

	if !exists || conn == nil {
		return
	}

	data, err := json.Marshal(msg)
	if err != nil {
		log.Printf("Failed to marshal WS message: %v", err)
		return
	}

	if err := conn.WriteMessage(websocket.TextMessage, data); err != nil {
		log.Printf("Failed to write WS message: %v", err)
		conn.Close()
		h.UnregisterConnection(videoID)
	}
}

func (h *WebSocketHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// Get video ID from URL
	// This would need proper auth in production

	conn, err := h.upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("WebSocket upgrade failed: %v", err)
		return
	}

	defer conn.Close()

	// Handle connection
	for {
		_, message, err := conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("WebSocket error: %v", err)
			}
			break
		}

		// Handle incoming messages (e.g., ping)
		var msg WSMessage
		if err := json.Unmarshal(message, &msg); err != nil {
			continue
		}

		if msg.Type == "ping" {
			conn.WriteJSON(WSMessage{Type: "pong"})
		}
	}
}

// BroadcastPhase sends a phase update to connected clients
func (h *WebSocketHandler) BroadcastPhase(videoID uint64, phase string, progress int, message string) {
	h.SendToVideo(videoID, WSMessage{
		Type:      "phase_update",
		VideoID:   videoID,
		Timestamp: time.Now().Format(time.RFC3339),
		Phase:     phase,
		Progress:  progress,
		Message:   message,
	})
}

// BroadcastStep sends a granular step update to connected clients
func (h *WebSocketHandler) BroadcastStep(videoID uint64, phase, step string, progress int, message string) {
	msg := WSMessage{
		Type:      "step_update",
		VideoID:   videoID,
		Timestamp: time.Now().Format(time.RFC3339),
		Phase:     phase,
		Step:      step,
		Progress:  progress,
		Message:   message,
	}
	h.SendToVideo(videoID, msg)
	h.BroadcastToAll(msg)
}

// BroadcastError sends an error to connected clients
func (h *WebSocketHandler) BroadcastError(videoID uint64, phase, step, errorMsg string) {
	msg := WSMessage{
		Type:      "error",
		VideoID:   videoID,
		Timestamp: time.Now().Format(time.RFC3339),
		Phase:     phase,
		Step:      step,
		Error:     errorMsg,
		Message:   errorMsg,
	}
	h.SendToVideo(videoID, msg)
	h.BroadcastToAll(msg)
}

// BroadcastComplete sends completion to connected clients
func (h *WebSocketHandler) BroadcastComplete(videoID uint64, downloadURL string) {
	msg := WSMessage{
		Type:      "completed",
		VideoID:   videoID,
		Timestamp: time.Now().Format(time.RFC3339),
		Phase:     "completed",
		Progress:  100,
		Message:   "Video generation complete!",
		Payload: map[string]interface{}{
			"download_url": downloadURL,
		},
	}
	h.SendToVideo(videoID, msg)
	h.BroadcastToAll(msg)
}
