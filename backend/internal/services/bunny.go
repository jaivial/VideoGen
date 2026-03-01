package services

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
	"path"
	"strings"
	"time"

	"video-generator/internal/config"
)

// extractFilenameFromURL extracts the filename from a full URL or returns the input if it's already just a filename
func extractFilenameFromURL(videoURL string) string {
	// If the URL doesn't contain "://", it's already just a filename
	if !strings.Contains(videoURL, "://") {
		return videoURL
	}

	// Remove query parameters if present
	if idx := strings.Index(videoURL, "?"); idx != -1 {
		videoURL = videoURL[:idx]
	}

	// Extract the basename from the URL path
	filename := path.Base(videoURL)
	return filename
}

type BunnyService struct {
	cfg    *config.Config
	client *http.Client
}

type BunnyStorageResponse struct {
	Guid            string `json:"Guid"`
	StorageZoneName string `json:"StorageZoneName"`
	DateCreated     int64  `json:"DateCreated"`
	LastModified    int64  `json:"LastModified"`
	Bytes           int64  `json:"Bytes"`
	IsReady         bool   `json:"IsReady"`
}

type BunnySignedURLResponse struct {
	URL string `json:"url"`
}

func NewBunnyService(cfg *config.Config) *BunnyService {
	return &BunnyService{
		cfg:    cfg,
		client: &http.Client{},
	}
}

func (s *BunnyService) IsConfigured() bool {
	return s != nil && s.cfg != nil && s.cfg.BunnyStorageName != "" && s.cfg.BunnyStoragePass != ""
}

// getCDNHost returns the CDN hostname for public URLs
// Uses BunnyCDNHost if set, otherwise derives from storage name
func (s *BunnyService) getCDNHost() string {
	if s.cfg.BunnyCDNHost != "" {
		return s.cfg.BunnyCDNHost
	}
	// Default to {storageName}.b-cdn.net
	if s.cfg.BunnyStorageName != "" {
		return s.cfg.BunnyStorageName + ".b-cdn.net"
	}
	return "storage.bunnycdn.com"
}

func (s *BunnyService) UploadVideo(fileName string, data []byte) (string, error) {
	if s.cfg.BunnyStorageName == "" {
		// Return placeholder URL in dev
		return fmt.Sprintf("https://storage.bunnycdn.com/videos/%s", fileName), nil
	}

	// Use storage.bunnycdn.com for upload (this is the API endpoint)
	storageHost := "storage.bunnycdn.com"
	url := fmt.Sprintf("https://%s/%s/videos/%s", storageHost, s.cfg.BunnyStorageName, fileName)

	req, err := http.NewRequest("PUT", url, bytes.NewReader(data))
	if err != nil {
		return "", fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Content-Type", "video/mp4")
	req.Header.Set("AccessKey", s.cfg.BunnyStoragePass)

	resp, err := s.client.Do(req)
	if err != nil {
		return "", fmt.Errorf("failed to upload video: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		respBody, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("bunny API error: %d - %s", resp.StatusCode, string(respBody))
	}

	// Return the CDN URL for public access
	// URL format: https://{cdnHost}/videos/filename.mp4
	cdnHost := s.getCDNHost()
	fullURL := fmt.Sprintf("https://%s/videos/%s", cdnHost, fileName)
	return fullURL, nil
}

func (s *BunnyService) DeleteVideo(videoURL string) error {
	if s.cfg.BunnyStorageName == "" {
		return nil // Skip in dev
	}

	// Extract filename from URL if it's a full URL
	filename := extractFilenameFromURL(videoURL)

	storageHost := "storage.bunnycdn.com"
	url := fmt.Sprintf("https://%s/%s/videos/%s", storageHost, s.cfg.BunnyStorageName, filename)

	req, err := http.NewRequest("DELETE", url, nil)
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("AccessKey", s.cfg.BunnyStoragePass)

	resp, err := s.client.Do(req)
	if err != nil {
		return fmt.Errorf("failed to delete video: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusNoContent {
		return fmt.Errorf("bunny delete API error: %d", resp.StatusCode)
	}

	return nil
}

func (s *BunnyService) GetSignedURL(videoURL string, expiration time.Duration) (string, error) {
	// Extract filename from URL if it's a full URL
	filename := extractFilenameFromURL(videoURL)

	// Use storage host for the API endpoint (signed URL requires storage host for token validation)
	storageHost := "storage.bunnycdn.com"

	if s.cfg.BunnyStorageName == "" {
		// Return public URL in dev
		return fmt.Sprintf("https://%s/videos/%s", storageHost, filename), nil
	}

	// Use Bunny's signed URL API with storage host
	expiry := time.Now().Add(expiration).Unix()
	url := fmt.Sprintf("https://%s/%s/videos/%s?expires=%d&token=%s",
		storageHost, s.cfg.BunnyStorageName, filename, expiry, s.cfg.BunnyStoragePass)

	return url, nil
}

// UploadMedia uploads a media file (video, image, audio) to Bunny storage
func (s *BunnyService) UploadMedia(filename string, data []byte, mediaType string) (string, error) {
	if s.cfg.BunnyStorageName == "" {
		// Return placeholder URL in dev
		return fmt.Sprintf("https://storage.bunnycdn.com/media/%s", filename), nil
	}

	// Determine content type based on media type
	contentType := "application/octet-stream"
	switch mediaType {
	case "video":
		contentType = "video/mp4"
	case "image":
		contentType = "image/jpeg"
	case "audio":
		contentType = "audio/mpeg"
	}

	// Use storage.bunnycdn.com for upload
	storageHost := "storage.bunnycdn.com"
	url := fmt.Sprintf("https://%s/%s/editor/%s", storageHost, s.cfg.BunnyStorageName, filename)

	req, err := http.NewRequest("PUT", url, bytes.NewReader(data))
	if err != nil {
		return "", fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Content-Type", contentType)
	req.Header.Set("AccessKey", s.cfg.BunnyStoragePass)

	resp, err := s.client.Do(req)
	if err != nil {
		return "", fmt.Errorf("failed to upload media: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		respBody, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("bunny API error: %d - %s", resp.StatusCode, string(respBody))
	}

	// Return the CDN URL for public access
	cdnHost := s.getCDNHost()
	fullURL := fmt.Sprintf("https://%s/editor/%s", cdnHost, filename)
	return fullURL, nil
}
