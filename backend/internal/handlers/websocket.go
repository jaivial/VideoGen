package handlers

import (
	"encoding/json"
	"log"
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/gorilla/websocket"
)

// WSMessage represents a WebSocket message with extended fields for granular progress
type WSMessage struct {
	Type          string      `json:"type"`
	VideoID       uint64      `json:"video_id,omitempty"`
	ProjectID     uint64      `json:"project_id,omitempty"`
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
	UserID        uint64      `json:"user_id,omitempty"`
}

type EditorSession struct {
	ProjectID uint64
	Clients   map[*websocket.Conn]uint64
	State     json.RawMessage
	Mu        sync.RWMutex
}

type wsClient struct {
	conn     *websocket.Conn
	writeMux sync.Mutex
}

func (c *wsClient) writeText(data []byte) error {
	c.writeMux.Lock()
	defer c.writeMux.Unlock()
	return c.conn.WriteMessage(websocket.TextMessage, data)
}

func (c *wsClient) writeJSON(v interface{}) error {
	c.writeMux.Lock()
	defer c.writeMux.Unlock()
	return c.conn.WriteJSON(v)
}

// WebSocketHandler manages WebSocket connections for video progress updates
type WebSocketHandler struct {
	clients       map[uint64]map[*wsClient]struct{}
	clientsMux    sync.RWMutex
	allClients    map[*wsClient]struct{}
	allClientsMux sync.RWMutex
	editorRooms   map[uint64]*EditorSession
	editorMux     sync.RWMutex
	upgrader      websocket.Upgrader
}

func NewWebSocketHandler() *WebSocketHandler {
	return &WebSocketHandler{
		clients:     make(map[uint64]map[*wsClient]struct{}),
		allClients:  make(map[*wsClient]struct{}),
		editorRooms: make(map[uint64]*EditorSession),
		upgrader: websocket.Upgrader{
			CheckOrigin: func(r *http.Request) bool {
				return true // Allow all origins in dev
			},
		},
	}
}

func (h *WebSocketHandler) JoinEditorSession(projectID uint64, conn *websocket.Conn, userID uint64) {
	h.editorMux.Lock()
	defer h.editorMux.Unlock()

	session, exists := h.editorRooms[projectID]
	if !exists {
		session = &EditorSession{
			ProjectID: projectID,
			Clients:   make(map[*websocket.Conn]uint64),
		}
		h.editorRooms[projectID] = session
	}

	session.Mu.Lock()
	session.Clients[conn] = userID
	session.Mu.Unlock()
}

func (h *WebSocketHandler) LeaveEditorSession(projectID uint64, conn *websocket.Conn) {
	h.editorMux.Lock()
	defer h.editorMux.Unlock()

	session, exists := h.editorRooms[projectID]
	if !exists {
		return
	}

	session.Mu.Lock()
	delete(session.Clients, conn)
	empty := len(session.Clients) == 0
	session.Mu.Unlock()

	if empty {
		delete(h.editorRooms, projectID)
	}
}

func (h *WebSocketHandler) BroadcastToEditor(projectID uint64, msg WSMessage) {
	h.editorMux.RLock()
	session, exists := h.editorRooms[projectID]
	h.editorMux.RUnlock()
	if !exists {
		return
	}

	data, err := json.Marshal(msg)
	if err != nil {
		log.Printf("Failed to marshal editor WS message: %v", err)
		return
	}

	session.Mu.RLock()
	defer session.Mu.RUnlock()

	for conn := range session.Clients {
		if err := conn.WriteMessage(websocket.TextMessage, data); err != nil {
			log.Printf("Failed to broadcast editor WS message: %v", err)
		}
	}
}

func (h *WebSocketHandler) UpdateEditorState(projectID uint64, state json.RawMessage, senderConn *websocket.Conn) {
	h.editorMux.RLock()
	session, exists := h.editorRooms[projectID]
	h.editorMux.RUnlock()
	if !exists {
		return
	}

	session.Mu.Lock()
	session.State = state
	session.Mu.Unlock()

	data, err := json.Marshal(WSMessage{
		Type:      "state_update",
		ProjectID: projectID,
		Payload:   state,
	})
	if err != nil {
		log.Printf("Failed to marshal editor state update: %v", err)
		return
	}

	session.Mu.RLock()
	defer session.Mu.RUnlock()

	for conn := range session.Clients {
		if conn == senderConn {
			continue
		}
		if err := conn.WriteMessage(websocket.TextMessage, data); err != nil {
			log.Printf("Failed to send editor state update: %v", err)
		}
	}
}

func (h *WebSocketHandler) HandleVideoProgress(videoID uint64) {
	// Connection already registered for this video
}

func (h *WebSocketHandler) RegisterVideoConnection(videoID uint64, conn *websocket.Conn) *wsClient {
	client := &wsClient{conn: conn}

	h.clientsMux.Lock()
	if _, ok := h.clients[videoID]; !ok {
		h.clients[videoID] = make(map[*wsClient]struct{})
	}
	h.clients[videoID][client] = struct{}{}
	h.clientsMux.Unlock()

	return client
}

func (h *WebSocketHandler) RegisterAllConnection(conn *websocket.Conn) *wsClient {
	client := &wsClient{conn: conn}

	h.allClientsMux.Lock()
	h.allClients[client] = struct{}{}
	h.allClientsMux.Unlock()

	return client
}

func (h *WebSocketHandler) UnregisterVideoConnection(videoID uint64, client *wsClient) {
	h.clientsMux.Lock()
	if videoClients, ok := h.clients[videoID]; ok {
		delete(videoClients, client)
		if len(videoClients) == 0 {
			delete(h.clients, videoID)
		}
	}
	h.clientsMux.Unlock()
}

func (h *WebSocketHandler) UnregisterAllConnection(client *wsClient) {
	h.allClientsMux.Lock()
	delete(h.allClients, client)
	h.allClientsMux.Unlock()
}

// BroadcastToAll sends a message to ALL connected clients (for logs page)
func (h *WebSocketHandler) BroadcastToAll(msg WSMessage) {
	data, err := json.Marshal(msg)
	if err != nil {
		log.Printf("Failed to marshal WS message: %v", err)
		return
	}

	h.allClientsMux.RLock()
	clients := make([]*wsClient, 0, len(h.allClients))
	for client := range h.allClients {
		clients = append(clients, client)
	}
	h.allClientsMux.RUnlock()

	for _, client := range clients {
		if err := client.writeText(data); err != nil {
			log.Printf("Failed to write WS message to client: %v", err)
			client.conn.Close()
			h.UnregisterAllConnection(client)
		}
	}
}

func (h *WebSocketHandler) ServeEditorHTTP(w http.ResponseWriter, r *http.Request) {
	projectIDStr := chi.URLParam(r, "projectId")
	projectID, err := strconv.ParseUint(projectIDStr, 10, 64)
	if err != nil {
		http.Error(w, "Invalid project ID", http.StatusBadRequest)
		return
	}

	userID := uint64(1)

	conn, err := h.upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("Editor WebSocket upgrade failed: %v", err)
		return
	}

	defer func() {
		h.LeaveEditorSession(projectID, conn)
		conn.Close()
	}()

	h.JoinEditorSession(projectID, conn, userID)

	h.editorMux.RLock()
	session := h.editorRooms[projectID]
	h.editorMux.RUnlock()
	if session != nil {
		session.Mu.RLock()
		state := session.State
		session.Mu.RUnlock()
		if len(state) > 0 {
			_ = conn.WriteJSON(WSMessage{
				Type:      "state_sync",
				ProjectID: projectID,
				Payload:   state,
			})
		}
	}

	for {
		_, message, err := conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("Editor WebSocket error: %v", err)
			}
			break
		}

		var msg WSMessage
		if err := json.Unmarshal(message, &msg); err != nil {
			continue
		}

		switch msg.Type {
		case "state_update":
			state, _ := json.Marshal(msg.Payload)
			h.UpdateEditorState(projectID, state, conn)
		case "cursor_move":
			msg.Type = "cursor_update"
			msg.ProjectID = projectID
			msg.UserID = userID
			h.editorMux.RLock()
			session := h.editorRooms[projectID]
			h.editorMux.RUnlock()
			if session == nil {
				continue
			}

			data, err := json.Marshal(msg)
			if err != nil {
				continue
			}

			session.Mu.RLock()
			for c := range session.Clients {
				if c == conn {
					continue
				}
				if err := c.WriteMessage(websocket.TextMessage, data); err != nil {
					log.Printf("Failed to send editor cursor update: %v", err)
				}
			}
			session.Mu.RUnlock()
		case "ping":
			_ = conn.WriteJSON(WSMessage{Type: "pong"})
		}
	}
}

func (h *WebSocketHandler) SendToVideo(videoID uint64, msg WSMessage) {
	data, err := json.Marshal(msg)
	if err != nil {
		log.Printf("Failed to marshal WS message: %v", err)
		return
	}

	h.clientsMux.RLock()
	videoClients, ok := h.clients[videoID]
	if !ok || len(videoClients) == 0 {
		h.clientsMux.RUnlock()
		return
	}

	clients := make([]*wsClient, 0, len(videoClients))
	for client := range videoClients {
		clients = append(clients, client)
	}
	h.clientsMux.RUnlock()

	for _, client := range clients {
		if err := client.writeText(data); err != nil {
			log.Printf("Failed to write WS message: %v", err)
			client.conn.Close()
			h.UnregisterVideoConnection(videoID, client)
		}
	}
}

func (h *WebSocketHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// Get video ID from URL
	idStr := chi.URLParam(r, "id")
	if idStr == "" {
		http.Error(w, "Missing video id", http.StatusBadRequest)
		return
	}

	videoID, err := strconv.ParseUint(idStr, 10, 64)
	if err != nil {
		http.Error(w, "Invalid video id", http.StatusBadRequest)
		return
	}

	conn, err := h.upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("WebSocket upgrade failed: %v", err)
		return
	}

	client := h.RegisterVideoConnection(videoID, conn)
	defer func() {
		h.UnregisterVideoConnection(videoID, client)
		conn.Close()
	}()

	// Acknowledge connection
	_ = client.writeJSON(WSMessage{
		Type:      "connected",
		VideoID:   videoID,
		Timestamp: time.Now().Format(time.RFC3339),
		Message:   "WebSocket connected",
	})

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
			_ = client.writeJSON(WSMessage{Type: "pong"})
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
		Payload: map[string]interface{}{
			"phase":    phase,
			"progress": progress,
			"message":  message,
		},
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
		Payload: map[string]interface{}{
			"phase":    phase,
			"step":     step,
			"progress": progress,
			"message":  message,
		},
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
		Payload: map[string]interface{}{
			"phase":   phase,
			"step":    step,
			"message": errorMsg,
			"error":   errorMsg,
		},
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
