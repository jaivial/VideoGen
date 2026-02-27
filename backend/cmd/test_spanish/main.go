package main

import (
	"encoding/json"
	"fmt"
	"video-generator/internal/services"
)

func main() {
	input := `00:00:00.328
The Bear and the Bee
00:00:04.656
(A version of the tale by TheFableCottage.com)
00:00:10.386
Everybody knows that bears love honey.
00:00:14.750
One day Mr Bear looks in his cupboard and he can't find any honey.
00:00:22.314
"Oh no! No honey!" he says.
00:00:27.186
So he goes into the forest to find some.
00:00:33.445
He sees a beehive in a tree.`

	segments, err := services.ParseTranscript(input)
	if err != nil {
		fmt.Printf("ParseTranscript failed: %v\n", err)
		return
	}

	// Simulate Spanish translation for each segment
	spanishTranslations := []string{
		"El Oso y la Abeja",
		"(Una versión del cuento de TheFableCottage.com)",
		"Todo el mundo sabe que los osos aman la miel.",
		"Un día el Sr. Oso mira en su despensa y no encuentra miel.",
		"¡Oh, no! ¡No hay miel! - dice.",
		"Así que entra en el bosque para encontrar algo.",
		"Ve una colmena en un árbol.",
	}

	// Set translated text for each segment
	for i := range segments {
		if i < len(spanishTranslations) {
			segments[i].TranslatedText = spanishTranslations[i]
		}
	}

		fmt.Println("=== PARSED TRANSCRIPT SEGMENTS (Spanish) ===")
	for _, seg := range segments {
		fmt.Printf("Index: %d\n", seg.Index)
		fmt.Printf("  Timestamp: %s\n", seg.Timestamp)
		fmt.Printf("  StartTime: %.3f seconds\n", seg.StartTime)
		fmt.Printf("  Duration: %.3f seconds\n", seg.Duration)
		fmt.Printf("  OriginalText: %s\n", seg.OriginalText)
		fmt.Printf("  TranslatedText: %s\n", seg.TranslatedText)
		fmt.Println()
	}

	// Print as JSON
	jsonBytes, _ := json.MarshalIndent(segments, "", "  ")
	fmt.Println("=== JSON OUTPUT ===")
	fmt.Println(string(jsonBytes))

	// Test CreateImageGroups with translated text
	groups := services.CreateImageGroups(segments, 5)
	fmt.Println("=== IMAGE GROUPS WITH SPANISH (group size 5) ===")
	for _, g := range groups {
		fmt.Printf("Group %d: chunks %d-%d (%d chunks)\n", g.ID, g.ChunkStart, g.ChunkEnd-1, g.ChunkCount)
		fmt.Printf("  Prompt: %s\n\n", g.Prompt)
	}

	// Test GenerateUnifiedTranscriptText with translated text
	unified := services.GenerateUnifiedTranscriptText(segments)
	fmt.Println("=== UNIFIED TEXT FOR TTS (Spanish) ===")
	fmt.Println(unified)
}
