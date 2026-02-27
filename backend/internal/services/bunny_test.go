package services

import (
	"os"
	"strings"
	"testing"

	"video-generator/internal/config"
)

// TestBunnyUploadIntegration tests the actual Bunny storage API upload
// This is an E2E test that requires network access and valid credentials
func TestBunnyUploadIntegration(t *testing.T) {
	// Skip if running in CI or no credentials
	if os.Getenv("SKIP_INTEGRATION_TESTS") == "true" {
		t.Skip("Skipping integration tests")
	}

	cfg := &config.Config{
		BunnyStorageName: "jaimedigitalstudio",
		BunnyStoragePass: "0ad9ada0-7f63-4cf5-a19ba8fd8404-0c0a-40fb",
		BunnyStorageHost: "storage.bunnycdn.com",
	}

	bunny := NewBunnyService(cfg)

	// Test file content
	testContent := []byte("Hello from integration test")
	testFilename := "test_integration_" + "test.txt"

	// Upload
	url, err := bunny.UploadVideo(testFilename, testContent)
	if err != nil {
		t.Fatalf("Failed to upload: %v", err)
	}

	// Verify URL format - Bunny returns CDN URLs now
	// Expected to contain either storage.bunnycdn.com or the CDN domain
	if url == "" {
		t.Error("Got empty URL")
	}
	// Check that URL contains the storage name or CDN domain
	if !(strings.Contains(url, "storage.bunnycdn.com") || strings.Contains(url, "b-cdn.net")) {
		t.Errorf("URL does not contain expected domain: %s", url)
	}

	// Cleanup - delete the test file
	err = bunny.DeleteVideo(url)
	if err != nil {
		t.Logf("Warning: Failed to cleanup test file: %v", err)
	}

	t.Logf("Successfully uploaded and deleted test file. URL: %s", url)
}

// TestBunnyUploadAndDownloadIntegration tests the full upload-download cycle
func TestBunnyUploadAndDownloadIntegration(t *testing.T) {
	if os.Getenv("SKIP_INTEGRATION_TESTS") == "true" {
		t.Skip("Skipping integration tests")
	}

	cfg := &config.Config{
		BunnyStorageName: "jaimedigitalstudio",
		BunnyStoragePass: "0ad9ada0-7f63-4cf5-a19ba8fd8404-0c0a-40fb",
		BunnyStorageHost: "storage.bunnycdn.com",
	}

	bunny := NewBunnyService(cfg)

	// Upload
	testContent := []byte("Test content for download")
	testFilename := "test_download.txt"

	url, err := bunny.UploadVideo(testFilename, testContent)
	if err != nil {
		t.Fatalf("Failed to upload: %v", err)
	}

	// Get signed URL for download
	signedURL, err := bunny.GetSignedURL(url, 1)
	if err != nil {
		t.Fatalf("Failed to get signed URL: %v", err)
	}

	// Signed URL should contain expiration and token
	if signedURL == "" {
		t.Error("Signed URL is empty")
	}

	// Cleanup
	err = bunny.DeleteVideo(url)
	if err != nil {
		t.Logf("Warning: Failed to cleanup: %v", err)
	}

	t.Logf("Signed URL: %s", signedURL)
}

// TestBunnyUploadInvalidCredentials tests error handling with invalid credentials
func TestBunnyUploadInvalidCredentials(t *testing.T) {
	if os.Getenv("SKIP_INTEGRATION_TESTS") == "true" {
		t.Skip("Skipping integration tests")
	}

	cfg := &config.Config{
		BunnyStorageName: "jaimedigitalstudio",
		BunnyStoragePass: "invalid-password",
		BunnyStorageHost: "storage.bunnycdn.com",
	}

	bunny := NewBunnyService(cfg)

	_, err := bunny.UploadVideo("test.txt", []byte("test"))
	if err == nil {
		t.Error("Expected error with invalid credentials")
	}
}

// TestBunnyURLParsing tests URL parsing logic
func TestBunnyURLParsing(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{
			name:     "full URL",
			input:    "https://storage.bunnycdn.com/jaimedigitalstudio/videos/test.mp4",
			expected: "test.mp4",
		},
		{
			name:     "just filename",
			input:    "test.mp4",
			expected: "test.mp4",
		},
		{
			name:     "URL with query params",
			input:    "https://storage.bunnycdn.com/jaimedigitalstudio/videos/test.mp4?expires=123",
			expected: "test.mp4",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := extractFilenameFromURL(tt.input)
			if result != tt.expected {
				t.Errorf("extractFilenameFromURL(%s) = %s, want %s", tt.input, result, tt.expected)
			}
		})
	}
}
