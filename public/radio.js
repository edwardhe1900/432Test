document.addEventListener('DOMContentLoaded', () => {
    // Elements - updated to match the IDs in radio.html
    const playButton = document.getElementById('playButton');
    const stopButton = document.getElementById('stopButton');
    const frequencyToggle = document.getElementById('frequencyToggle');
    const statusText = document.getElementById('statusText');
    
    let audioElement = document.createElement('audio');
    audioElement.style.display = 'none';
    document.body.appendChild(audioElement);
    let audioContext = null;
    let audioSource = null;
    let isPlaying = false;
    
    // Function to initialize audio context
    function initAudio() {
        // If we already have an audio context but it's in a closed state, we need to recreate it
        if (audioContext && (audioContext.state === 'closed')) {
            audioContext = null;
            audioSource = null;
        }
        if (audioContext) return true;
        try {
            // Create audio context
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
            audioElement.crossOrigin = "anonymous";
            audioElement.src = "/stream";
            audioSource = audioContext.createMediaElementSource(audioElement);
            audioSource.connect(audioContext.destination);
            // Update UI
            statusText.textContent = "Initializing...";
            console.log("Audio initialized successfully");
            return true;
        } catch (error) {
            console.error("Audio initialization error:", error);
            statusText.textContent = "Error: Could not initialize audio";
            return false;
        }
    }
    
    // Play button click handler
    playButton.addEventListener('click', function() {
        console.log("Play button clicked");
        if (!initAudio()) return;
        // Resume audio context if it was suspended (needed for Chrome)
        if (audioContext && audioContext.state === 'suspended') {
            audioContext.resume();
        }
        // Ensure we have a fresh stream URL to prevent caching issues
        audioElement.src = "/stream?t=" + new Date().getTime();
        // Start playback
        audioElement.play().then(() => {
            applyPitchShifting(frequencyToggle.checked);
            // Update UI
            isPlaying = true;
            playButton.disabled = true;
            stopButton.disabled = false;
            statusText.textContent = frequencyToggle.checked ? 
                "Playing at 432Hz" : "Playing at standard tuning (440Hz)";
        }).catch(error => {
            console.error("Playback failed:", error);
            statusText.textContent = "Error: Could not play stream";
        });
    });
    
    // Stop button click handler
    stopButton.addEventListener('click', function() {
        console.log("Stop button clicked");
        if (audioElement) {
            audioElement.pause();
            audioElement.currentTime = 0;
            
            // Properly clean up the audio context
            if (audioContext) {
                // Suspend the context instead of closing it to allow for reuse
                audioContext.suspend().then(() => {
                    console.log("Audio context suspended");
                }).catch(err => {
                    console.error("Error suspending audio context:", err);
                });
            }
        }
        
        // Update UI
        isPlaying = false;
        playButton.disabled = false;
        stopButton.disabled = true;
        statusText.textContent = "Radio stopped";
    });
    
    // Toggle 432Hz mode
    frequencyToggle.addEventListener('change', function() {
        console.log("Frequency toggle changed:", this.checked);
        if (audioElement && !audioElement.paused) {
            applyPitchShifting(this.checked);
            statusText.textContent = this.checked ? 
                "Playing at 432Hz" : "Playing at standard tuning (440Hz)";
        }
    });
    
    // Apply pitch shifting based on toggle state
    function applyPitchShifting(enable432Hz) {
        console.log("Applying pitch shifting, 432Hz mode:", enable432Hz);
        if (!audioContext || !audioElement) {
            console.error("Cannot apply pitch shifting - audio not initialized");
            return;
        }
        const pitchRatio = 432/440; // ~0.9818
        try {
            if (enable432Hz) {
                // Use playbackRate for pitch shifting (simple and effective)
                audioElement.playbackRate = pitchRatio;
            } else {
                // Reset to normal pitch
                audioElement.playbackRate = 1.0;
            }
        } catch (e) {
            console.error("Error applying pitch shifting:", e);
        }
    }
});