let currentSpeech = null;

// ================== Function to convert text to speech using backend TTS or browser fallback
async function speak(text) {
    try {
        if (currentSpeech && 'speechSynthesis' in window) {
            window.speechSynthesis.cancel(); // Stop any current speech
            currentSpeech = null;
        }

        // Try backend TTS first
        const response = await fetch('/speak', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text })
        });

        if (!response.ok) throw new Error('Backend TTS failed');
        currentSpeech = { source: 'backend', text };
        return await response.json();
    } catch (error) {
        console.error("TTS Error:", error);

        // Fallback to browser TTS
        if ('speechSynthesis' in window) {
            return new Promise(resolve => {
                const utterance = new SpeechSynthesisUtterance(text);

                utterance.onend = () => { currentSpeech = null; resolve(); };
                utterance.onerror = (e) => { console.error("Web Speech Error:", e); currentSpeech = null; resolve(); };

                window.speechSynthesis.speak(utterance);
                currentSpeech = { source: 'browser', utterance };
            });
        }

        console.warn("No TTS available in this browser");
        return Promise.resolve();
    }
}

// ================== Stop current speech playback if any
function stopSpeaking() {
    console.log("stopSpeaking called");
    if (currentSpeech && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        currentSpeech = null;
        console.log("Speech canceled.");
    }
}
window.stopSpeaking = stopSpeaking;  // Make global


// ================== Function to auto-speak content from the output box after processing
async function Post() {
    const output = document.getElementById("output");
    const responseText = output.innerText.trim();
    if (responseText && !["Ask Me Anything", "Thinking...", "Listening...", "Processing..."].includes(responseText)) {
        await speak(responseText);
    }
}

// ================== Function to fetch AI response from the backend
async function getAIResponse(userInput) {
    try {
        const response = await fetch('/ai_response', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: userInput })
        });
        if (!response.ok) throw new Error('AI response failed');
        return await response.json();
    } catch (error) {
        console.error("AI Error:", error);
        return { response: "Sorry, I couldn't process your request." };
    }
}

// ================== Function to handle sending user text input and speaking the response
async function sendText() {
    const textValue = document.getElementById("text").value.trim();
    if (!textValue) return;

    const output = document.getElementById("output");
    output.innerText = "Thinking...";

    try {
        const aiResponse = await getAIResponse(textValue);
        output.innerText = aiResponse.response;
        document.getElementById("text").value = "";
        await speak(aiResponse.response);
    } catch (error) {
        output.innerText = "Error: " + error.message;
    }
}

// ================== Function to handle speech-to-text using voice input
async function sendVoice() {
    const output = document.getElementById("output");
    const micButton = document.getElementById("micButton");

    output.innerText = "Listening...";
    micButton.style.color = "red"; // Indicate mic is active

    try {
        const voiceResponse = await fetch('/voice');
        if (!voiceResponse.ok) throw new Error('Voice recognition failed');
        const voiceData = await voiceResponse.json();

        output.innerText = "Processing...";
        const aiResponse = await getAIResponse(voiceData.recognized_text);
        output.innerText = aiResponse.response;

        await speak(aiResponse.response);
    } catch (error) {
        console.error("Error:", error);
        output.innerText = "Error: " + (error.message || "Processing failed");
    } finally {
        micButton.style.color = ""; // Reset mic button style
    }
}

// ==================Fetch real-time sensor data from the backend
function fetchData() {
    fetch('/latest')
        .then(response => {
            if (!response.ok) throw new Error('Sensor data failed');
            return response.json();
        })
        .then(data => {
            document.getElementById('blood_pressure').innerText = data.spo2 || "--";
            document.getElementById('heart_rate').innerText = data.heart_rate || "--";
            document.getElementById('body_temperature').innerText = data.body_temperature || "--";
            document.getElementById('environment_temperature').innerText = data.environment_temperature || "--";
            document.getElementById('ir').innerText = data.ir || "--";
            document.getElementById('red').innerText = data.red || "--";
        })
        .catch(error => console.error("Sensor error:", error));
}


//================== Fetch and update graph image for a specific sensor
function fetchGraph(sensor, imgId) {
    fetch('/graph/' + sensor)
        .then(response => {
            if (!response.ok) throw new Error('Graph data failed');
            return response.json();
        })
        .then(data => {
            if (data.graph) {
                document.getElementById(imgId).src = data.graph;
            }
        })
        .catch(error => console.error(`Graph error (${sensor}):`, error));
}


// ==================Fetch all sensor graphs
function updateGraphs() {
    fetchGraph('spo2', 'bp_graph');
    fetchGraph('heart_rate', 'hr_graph');
    fetchGraph('body_temperature', 'bt_graph');
    fetchGraph('environment_temperature', 'et_graph');
}


// ==================Fetch both sensor values and their graphs
function fetchSensorData() {
    fetchData();
    updateGraphs();
}


// ==================Runs on page load - greets the user and loads sensor data
window.onload = async function () {
    fetchSensorData();
};

// ================== Send sensor data to backend
async function sendSensorData() {
    try {
        const response = await fetch('/latest');
        if (!response.ok) throw new Error('Failed to fetch sensor data');
        return await response.json();
    } catch (error) {
        console.error("Sensor data error:", error);
        return {
            heart_rate: null,
            spo2: null,
            body_temperature: null,
            environment_temperature: null
        };
    }
}


// ================== Patient Registration System

// List of questions with corresponding data fields
const questions = [
    { prompt: "What's your full name, please?", field: "name" },
    { prompt: "How young are you?", field: "age" },
    { prompt: "What's your gender?", field: "gender" },
    { prompt: "Can I have your phone number?", field: "contact" },
    { prompt: "And where do you live, lovely?", field: "address" },
    { prompt: "Do you have any past or current medical conditions you'd like to share?", field: "medicalHistory" },
    { prompt: "What's bothering you the most right now?", field: "chiefComplaint" },
    { prompt: "On a scale of 1 to 10, how much pain are you feeling?", field: "painLevel" },
    { prompt: "Can you describe your pain for me?", field: "painDescription" },
    { prompt: "Are you experiencing any other symptoms?", field: "additionalSymptoms" },
    { prompt: "Who should we contact in case of emergency? Full name, please.", field: "emergencyName" },
    { prompt: "What's their relationship to you?", field: "emergencyRelation" },
    { prompt: "What's their gender?", field: "emergencyGender" },
    { prompt: "What's their phone number?", field: "emergencyContact" },
    { prompt: "And their address, if you have it?", field: "emergencyAddress" }
];

let index = 0;
const synth = window.speechSynthesis;
let recog;

// Initialize speech recognition if available
if ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window) {
    recog = new (window.SpeechRecognition || window.webkitSpeechRecognition)();
    recog.lang = 'en-US';
    recog.interimResults = false;
    recog.maxAlternatives = 1;
}

// Speak function breaks text into smaller chunks to avoid speech synthesis timing issues
function speakChunked(text, callback) {
    const chunks = text.match(/[^.!?]+[.!?]*/g) || [text]; // split text into sentences or chunks
    let i = 0;

    function speakChunk() {
        if (i < chunks.length) {
            const utter = new SpeechSynthesisUtterance(chunks[i].trim());
            utter.onend = () => {
                i++;
                speakChunk();
            };
            synth.speak(utter);
        } else {
            if (callback) callback();
        }
    }

    speakChunk();
}

// Listen function uses Web Speech API to get user response via voice
function listen(onSuccess, onFailure) {
    if (!recog) {
        console.error("Speech recognition not available");
        if (onFailure) onFailure();
        return;
    }

    recog.start();

    recog.onresult = e => {
        const answer = e.results[0][0].transcript;
        if (answer && answer.trim() !== "") {
            if (onSuccess) onSuccess(answer);
        } else {
            if (onFailure) onFailure();
        }
    };

    recog.onerror = () => {
        if (onFailure) onFailure();
    };
}

// Main ask function cycles through the questions array, speaks prompt and waits for answer
function ask() {
    if (index < questions.length) {
        const q = questions[index];
        speakChunked(q.prompt, () => {
            setTimeout(() => {
                listen(
                    answer => {
                        const element = document.getElementById(q.field);
                        if (element) {
                            element.innerText = answer;
                        }
                        index++;
                        ask();
                    },
                    () => {
                        speakChunked("I didn't catch that. Could you please repeat?", () => {
                            ask();
                        });
                    }
                );
            }, 100);
        });
    } else {
        // After all questions are answered
        speakChunked("Please place your hand on the sensor now.", () => {
            speakChunked("Registration complete. Now I will take your picture.", () => {
                captureAndSubmit();
            });
        });
    }
}

// Starts the conversation flow
function start() {
    index = 0;
    ask();
}

// Capture photo and submit data
function captureAndSubmit() {
    fetch('/take_picture')
        .then(response => response.json())
        .then(data => {
            if (data.status === 'success') {
                const photoFilename = data.filename;
                submitToDatabase(photoFilename);
            } else {
                alert("Failed to take photo.");
                submitToDatabase(null);
            }
        })
        .catch(error => {
            console.error("Photo error:", error);
            submitToDatabase(null);
        });
}

// ================== Submit to Backend Database
async function submitToDatabase(photoFilename = null) {
    const sensor = await sendSensorData();

    const data = {
        name: document.getElementById("name")?.innerText || "",
        age: document.getElementById("age")?.innerText || "",
        gender: document.getElementById("gender")?.innerText || "",
        contact: document.getElementById("contact")?.innerText || "",
        address: document.getElementById("address")?.innerText || "",
        medicalHistory: document.getElementById("medicalHistory")?.innerText || "",
        chiefComplaint: document.getElementById("chiefComplaint")?.innerText || "",
        painLevel: document.getElementById("painLevel")?.innerText || "",
        painDescription: document.getElementById("painDescription")?.innerText || "",
        additionalSymptoms: document.getElementById("additionalSymptoms")?.innerText || "",
        emergencyName: document.getElementById("emergencyName")?.innerText || "",
        emergencyRelation: document.getElementById("emergencyRelation")?.innerText || "",
        emergencyGender: document.getElementById("emergencyGender")?.innerText || "",
        emergencyContact: document.getElementById("emergencyContact")?.innerText || "",
        emergencyAddress: document.getElementById("emergencyAddress")?.innerText || "",
        photoFilename: photoFilename,
        heart_rate: sensor.heart_rate,
        spo2: sensor.spo2,
        body_temperature: sensor.body_temperature,
        environment_temperature: sensor.environment_temperature
    };

    fetch("/submit_patient_data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data)
    })
    .then(response => response.json())
    .then(result => {
        console.log("✅ Patient data with sensor values saved!");
        window.location.href = "/dashboard";
    })
    .catch(error => {
        console.error("❌ Submission error:", error);
    });
}

// ================== Dashboard Functions

document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('patientTable')) {
        loadPatients();

        const searchInput = document.getElementById('searchInput');
        if (searchInput) {
            searchInput.addEventListener('input', () => {
                const filter = searchInput.value.toLowerCase();
                filterPatients(filter);
            });
        }
    }
});

let patientsData = [];

function loadPatients() {
    const tbody = document.querySelector('#patientTable tbody');
    if (!tbody) return;
    
    tbody.innerHTML = '';

    fetch('/patients')
        .then(res => {
            if (!res.ok) throw new Error('Network response was not OK');
            return res.json();
        })
        .then(data => {
            patientsData = data;
            renderTable(data);
        })
        .catch(err => {
            console.error('Failed to load patient data:', err);
            tbody.innerHTML = '<tr><td colspan="21">Error loading data</td></tr>';
        });
}

function renderTable(data) {
    const tbody = document.querySelector('#patientTable tbody');
    if (!tbody) return;
    
    tbody.innerHTML = '';

    data.forEach(patient => {
        const row = document.createElement('tr');
        row.setAttribute("data-id", patient.id);
        row.innerHTML = `
            <td><img class="patient-photo" src="/static/uploads/${patient.photoFilename || 'default.jpg'}" alt="Photo"></td>
            <td>${patient.name || ''}</td>
            <td>${patient.age || ''}</td>
            <td>${patient.gender || ''}</td>
            <td>${patient.contact || ''}</td>
            <td>${patient.address || ''}</td>
            <td>${patient.chiefComplaint || ''}</td>
            <td>${patient.painLevel || ''}</td>
            <td>${patient.painDescription || ''}</td>
            <td>${patient.additionalSymptoms || ''}</td>
            <td>${patient.medicalHistory || ''}</td>
            <td>${patient.emergencyName || ''}</td>
            <td>${patient.emergencyRelation || ''}</td>
            <td>${patient.emergencyGender || ''}</td>
            <td>${patient.emergencyContact || ''}</td>
            <td>${patient.emergencyAddress || ''}</td>
            <td>${patient.heart_rate || ''}</td>
            <td>${patient.spo2 || ''}</td>
            <td>${patient.body_temperature || ''}</td>
            <td>${patient.environment_temperature || ''}</td>
            <td>
                <button onclick="viewPatient('${patient.id}')">View</button>
                <button onclick="editPatient('${patient.id}')">Edit</button>
                <button onclick="deletePatient('${patient.id}')">Delete</button>
            </td>
        `;
        tbody.appendChild(row);
    });
}

function filterPatients(filter) {
    const filtered = patientsData.filter(patient =>
        (patient.name && patient.name.toLowerCase().includes(filter)) ||
        (patient.age && String(patient.age).includes(filter)) ||
        (patient.chiefComplaint && patient.chiefComplaint.toLowerCase().includes(filter))
    );
    renderTable(filtered);
}

function viewPatient(id) {
    window.location.href = `patient-details.html?id=${id}`;
}

function editPatient(id) {
    const row = document.querySelector(`tr[data-id="${id}"]`);
    if (!row) return;

    const cells = row.querySelectorAll("td");
    
    // Replace cells 1-15 with input fields (skip photo cell at index 0)
    for (let i = 1; i <= 15; i++) {
        if (cells[i]) {
            const val = cells[i].innerText;
            cells[i].innerHTML = `<input type="text" value="${val}" style="width:100%;">`;
        }
    }

    // Change the last cell to Save/Cancel buttons
    if (cells[20]) {
        cells[20].innerHTML = `
            <button onclick="savePatient(${id})">Save</button>
            <button onclick="loadPatients()">Cancel</button>
        `;
    }
}

function deletePatient(id) {
    if (confirm("Are you sure you want to delete this patient?")) {
        fetch(`/delete_patient/${id}`, {
            method: 'DELETE'
        })
        .then(res => {
            if (!res.ok) throw new Error("Failed to delete");
            return res.json();
        })
        .then(result => {
            if (result.status === 'success') {
                alert("Patient deleted");
                loadPatients();
            } else {
                alert("Error: " + result.message);
            }
        })
        .catch(err => {
            console.error(err);
            alert("Failed to delete patient.");
        });
    }
}

function savePatient(id) {
    const row = document.querySelector(`tr[data-id="${id}"]`);
    if (!row) return;
    
    const inputs = row.querySelectorAll("input");

    if (inputs.length < 15) {
        alert("Error: Not all fields found for editing.");
        return;
    }

    const ageValue = parseInt(inputs[1].value);
    const painLevelValue = parseInt(inputs[6].value);

    if (isNaN(ageValue)) {
        alert("Please enter a valid number for age.");
        return;
    }

    if (isNaN(painLevelValue)) {
        alert("Please enter a valid number for pain level.");
        return;
    }

    const updatedData = {
        name: inputs[0].value,
        age: ageValue,
        gender: inputs[2].value,
        contact: inputs[3].value,
        address: inputs[4].value,
        chiefComplaint: inputs[5].value,
        painLevel: painLevelValue,
        painDescription: inputs[7].value,
        additionalSymptoms: inputs[8].value,
        medicalHistory: inputs[9].value,
        emergencyName: inputs[10].value,
        emergencyRelation: inputs[11].value,
        emergencyGender: inputs[12].value,
        emergencyContact: inputs[13].value,
        emergencyAddress: inputs[14].value
    };

    console.log("📤 Submitting updated data:", updatedData);

    fetch(`/update_patient/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updatedData)
    })
    .then(res => {
        if (!res.ok) throw new Error("Update failed");
        return res.json();
    })
    .then(result => {
        if (result.status === "success") {
            alert("Patient updated successfully");
            loadPatients();
        } else {
            alert("Error: " + result.message);
        }
    })
    .catch(err => {
        console.error(err);
        alert("Update failed.");
    });
}

function exportCSV() {
    fetch("/export_csv")
        .then(response => {
            if (!response.ok) throw new Error("Failed to export CSV");
            return response.blob();
        })
        .then(blob => {
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = "patients.csv";
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
        })
        .catch(error => {
            console.error("CSV export failed:", error);
            alert("Export failed.");
        });
}

function printPage() {
    window.print();
}