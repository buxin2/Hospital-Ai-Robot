# =================== Imports ====================
# Standard library imports
import os
import io
import time
import random
import csv
import threading
from threading import Lock
from io import StringIO

# Third-party imports
from flask import Flask, Response, render_template, jsonify, request, make_response
import cv2
import speech_recognition as sr
import requests
import pyttsx3 as t
import serial
import matplotlib.pyplot as plt
import matplotlib
import base64
from flask_sqlalchemy import SQLAlchemy
from flask_cors import CORS
from datetime import datetime

# Flask app setup
app = Flask(__name__)
CORS(app)


# =================== Route Handlers ====================
@app.route('/')
def home():
    return render_template('main.html')

@app.route('/printing')
def printing():
    return render_template('printing.html')

@app.route('/patient-details.html')
def patient_details_page():
    return render_template('patient-details.html')


@app.route('/dashboard')
def dashboard():
    return render_template('dashboard.html')

# =================== taking image ====================

# Video capture
video_capture = cv2.VideoCapture(1)
video_lock = Lock()

def take_picture(frame, filename="captured_image.jpg"):
    """Saves the current frame as an image file."""
    cv2.imwrite(filename, frame)
    print(f"Picture saved as {filename}")

def generate_frames():
    """Generates frames from the webcam to stream to the web page."""
    while True:
        ret, frame = video_capture.read()
        if not ret:
            break
        # Convert the frame to JPEG
        ret, buffer = cv2.imencode('.jpg', frame)
        frame = buffer.tobytes()
        yield (b'--frame\r\n'
               b'Content-Type: image/jpeg\r\n\r\n' + frame + b'\r\n')
        

@app.route('/video_feed')
def video_feed():
    """Stream video feed from webcam."""
    return Response(generate_frames(), mimetype='multipart/x-mixed-replace; boundary=frame')

@app.route('/take_picture')
def capture_picture():
    """Capture and save a picture when called."""
    ret, frame = video_capture.read()
    if ret:
        # Save inside static/uploads
        filename = f"captured_image_{int(time.time())}.jpg"
        filepath = os.path.join('static/uploads', filename)
        take_picture(frame, filepath)

        # OPTIONAL: Save the filename to the most recent patient
        last_patient = Patient.query.order_by(Patient.id.desc()).first()
        if last_patient:
            last_patient.photo_filename = filename
            db.session.commit()

        return jsonify({"status": "success", "filename": filename})
    return jsonify({"status": "error", "message": "Failed to capture picture"})


# =================== voice ====================

# API configuration
API_KEY = "JJT2oAUiJNKaEzkGAcP0PpzZ1hBoExqz"
API_URL = "https://api.deepinfra.com/v1/openai/chat/completions"


# TTS lock
tts_lock = Lock()

# Text-to-speech engine
engine = t.init()
engine.setProperty('rate', 150)

def speak_text(text):
    """Convert text to speech using the system's default voice."""
    with tts_lock:
        try:
            engine.say(text)
            engine.runAndWait()
        except Exception as e:
            print(f"TTS error: {str(e)}")


# Speech recognition
recognizer = sr.Recognizer()
mic_lock = Lock()            

def process_voice():
    """Capture and process voice input from microphone."""
    with mic_lock:
        with sr.Microphone() as source:
            recognizer.adjust_for_ambient_noise(source, duration=0.5)
            try:
                audio = recognizer.listen(source, timeout=5)
                return recognizer.recognize_google(audio)
            except sr.WaitTimeoutError:
                return "No speech detected"
            except sr.UnknownValueError:
                return "Could not understand audio"
            except sr.RequestError as e:
                return f"Recognition error: {str(e)}"

def get_ai_response(user_input):
    """Get response from AI API."""
    headers = {
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "application/json"
    }
    prompt = {
        "model": "meta-llama/Meta-Llama-3-8B-Instruct",
        "messages": [
            {"role": "system", "content": "You are a medical assistant."},
            {"role": "user", "content": user_input}
        ],
        "temperature": 0.7,
        "max_tokens": 500
    }
    try:
        response = requests.post(API_URL, json=prompt, headers=headers, timeout=15)
        response.raise_for_status()
        return response.json()["choices"][0]["message"]["content"]
    except requests.exceptions.Timeout:
        return "The request timed out. Please try again."
    except requests.exceptions.RequestException as e:
        return "AI error: Please try again later."

@app.route('/voice')
def voice():
    text = process_voice()
    return jsonify({"recognized_text": text})

@app.route('/ai_response', methods=['POST'])
def ai_response():
    data = request.get_json()
    user_text = data.get('text', '')
    response = get_ai_response(user_text)
    threading.Thread(target=speak_text, args=(response,)).start()
    return jsonify({"response": response})



# =================== Sensor ====================
# Data history storage
latest_data = {
    'heart_rate': 100,
    'spo2': 0.56,
    'body_temperature': 100,
    'environment_temperature': 90
}
@app.route('/sensor-data', methods=['POST'])
def receive_data():
    global latest_data
    data = request.get_json()
    latest_data['heart_rate'] = data.get('heart_rate', latest_data['heart_rate'])
    latest_data['spo2'] = data.get('spo2', latest_data['spo2'])
    latest_data['body_temperature'] = data.get('body_temperature', latest_data['body_temperature'])
    latest_data['environment_temperature'] = data.get('environment_temperature', latest_data['environment_temperature'])
    return jsonify({"status": "success"}), 200

@app.route('/set-servos', methods=['POST'])
def set_servos():
    global latest_data
    data = request.get_json()
    latest_data['servo1_angle'] = int(data.get('servo1', 90))
    latest_data['servo2_angle'] = int(data.get('servo2', 90))
    print(f"Updated servo angles: {latest_data['servo1_angle']}°, {latest_data['servo2_angle']}°")
    return jsonify({"status": "updated"}), 200

@app.route('/latest', methods=['GET'])
def get_latest():
    return jsonify(latest_data)



# =================== Graph ====================

# Configure matplotlib
matplotlib.use('Agg')

def generate_graph(sensor):
    """Generate a graph for the specified sensor data."""
    if sensor not in latest_data:
        return None
    
    plt.figure(figsize=(6, 3))
    values = latest_data[sensor]
    
    plt.plot(values, marker='o', linestyle='-')
    plt.grid()
    
    img = io.BytesIO()
    plt.savefig(img, format='png')
    img.seek(0)
    plt.close()
    
    return f'data:image/png;base64,{base64.b64encode(img.getvalue()).decode()}'

@app.route('/graph/<sensor>')
def graph(sensor):
    graph_url = generate_graph(sensor)
    if graph_url:
        return jsonify({"graph": graph_url})
    else:
        return jsonify({"error": "Invalid sensor name"}), 400



# =================== Database Configuration ====================
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///patientsss.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
db = SQLAlchemy(app)

class Patient(db.Model):
    """Patient database model."""
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    age = db.Column(db.Integer, nullable=False)
    gender = db.Column(db.String(10), nullable=False)
    contact = db.Column(db.String(20), nullable=False)
    address = db.Column(db.String(255), nullable=False)
    chief_complaint = db.Column(db.String(255), nullable=True)
    pain_level = db.Column(db.Integer, nullable=True)
    pain_description = db.Column(db.String(255), nullable=True)
    additional_symptoms = db.Column(db.String(255), nullable=True)
    medical_history = db.Column(db.String(255), nullable=True)
    emergency_name = db.Column(db.String(100), nullable=True)
    emergency_relation = db.Column(db.String(50), nullable=True)
    emergency_gender = db.Column(db.String(10), nullable=True)
    emergency_contact = db.Column(db.String(20), nullable=True)
    emergency_address = db.Column(db.String(255), nullable=True)
    photo_filename = db.Column(db.String(255), nullable=True)  # ✅ NEW COLUMN

    # ✅ Sensor fields
    heart_rate = db.Column(db.Integer)
    spo2 = db.Column(db.Float)
    body_temperature = db.Column(db.Float)
    environment_temperature = db.Column(db.Float)
    timestamp = db.Column(db.DateTime, default= datetime.utcnow)

# =================== Initialize DB ====================
with app.app_context():
    db.create_all()

# =================== Patient Routes ====================
@app.route('/submit_patient_data', methods=['POST'])
def receive_patient_data():
    data = request.get_json()

    new_patient = Patient(
        name=data['name'],
        age=data['age'],
        gender=data['gender'],
        contact=data['contact'],
        address=data['address'],
        chief_complaint=data['chiefComplaint'],
        pain_level=data['painLevel'],
        pain_description=data['painDescription'],
        additional_symptoms=data['additionalSymptoms'],
        medical_history=data['medicalHistory'],
        emergency_name=data['emergencyName'],
        emergency_relation=data['emergencyRelation'],
        emergency_gender=data['emergencyGender'],
        emergency_contact=data['emergencyContact'],
        emergency_address=data['emergencyAddress'],
        photo_filename=data.get('photoFilename'),

        # ✅ Save sensor values
        heart_rate=data.get('heart_rate'),
        spo2=data.get('spo2'),
        body_temperature=data.get('body_temperature'),
        environment_temperature=data.get('environment_temperature')
    )

    try:
        db.session.add(new_patient)
        db.session.commit()
        return jsonify({"status": "success", "message": "Patient + sensor data saved!"}), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({"status": "error", "message": str(e)}), 400


@app.route('/get_patient/<int:id>', methods=['GET'])
def get_patient(id):
    patient = Patient.query.get(id)
    if not patient:
        return jsonify({"message": "Patient not found"}), 404
    return jsonify({
        "id": patient.id,
        "name": patient.name,
        "age": patient.age,
        "gender": patient.gender,
        "contact": patient.contact,
        "address": patient.address,
        "chiefComplaint": patient.chief_complaint,
        "painLevel": patient.pain_level,
        "painDescription": patient.pain_description,
        "additionalSymptoms": patient.additional_symptoms,
        "medicalHistory": patient.medical_history,
        "emergencyName": patient.emergency_name,
        "emergencyRelation": patient.emergency_relation,
        "emergencyGender": patient.emergency_gender,
        "emergencyContact": patient.emergency_contact,
        "emergencyAddress": patient.emergency_address,
        "photoFilename": patient.photo_filename,  # ✅ Return photo

        # ✅ Add sensor data
        "heart_rate": patient.heart_rate,
        "spo2": patient.spo2,
        "body_temperature": patient.body_temperature,
        "environment_temperature": patient.environment_temperature
    })


@app.route('/patients')
def get_patients():
    patients = Patient.query.all()
    return jsonify([
        {
            'id': p.id,
            'name': p.name,
            'age': p.age,
            'gender': p.gender,
            'contact': p.contact,
            'address': p.address,
            'chiefComplaint': p.chief_complaint,
            'painLevel': p.pain_level,
            'painDescription': p.pain_description,
            'additionalSymptoms': p.additional_symptoms,
            'medicalHistory': p.medical_history,
            'emergencyName': p.emergency_name,
            'emergencyRelation': p.emergency_relation,
            'emergencyGender': p.emergency_gender,
            'emergencyContact': p.emergency_contact,
            'emergencyAddress': p.emergency_address,
            'photoFilename': p.photo_filename,

            # ✅ Add sensor data
            'heart_rate': p.heart_rate,
            'spo2': p.spo2,
            'body_temperature': p.body_temperature,
            'environment_temperature': p.environment_temperature
        } for p in patients
    ])

@app.route('/update_patient/<int:patient_id>', methods=['PUT'])
def update_patient(patient_id):
    data = request.get_json()
    patient = Patient.query.get_or_404(patient_id)

    try:
        patient.name = data['name']
        patient.age = data['age']
        patient.gender = data['gender']
        patient.contact = data['contact']
        patient.address = data['address']
        patient.chief_complaint = data['chiefComplaint']
        patient.pain_level = data['painLevel']
        patient.pain_description = data['painDescription']
        patient.additional_symptoms = data['additionalSymptoms']
        patient.medical_history = data['medicalHistory']
        patient.emergency_name = data['emergencyName']
        patient.emergency_relation = data['emergencyRelation']
        patient.emergency_gender = data['emergencyGender']
        patient.emergency_contact = data['emergencyContact']
        patient.emergency_address = data['emergencyAddress']
        # Optional: update photo_filename if provided
        if 'photoFilename' in data:
            patient.photo_filename = data['photoFilename']

        db.session.commit()
        return jsonify({'status': 'success', 'message': 'Patient updated successfully'})
    
    except Exception as e:
        db.session.rollback()
        return jsonify({'status': 'error', 'message': str(e)}), 400

@app.route('/export_csv', methods=['GET'])
def export_csv():
    patients = Patient.query.all()
    si = StringIO()
    writer = csv.writer(si)

    writer.writerow([
        "ID", "Name", "Age", "Gender", "Contact", "Address",
        "Chief Complaint", "Pain Level", "Pain Description", 
        "Additional Symptoms", "Medical History",
        "Emergency Name", "Emergency Relation", "Emergency Gender", 
        "Emergency Contact", "Emergency Address", "Photo Filename"
    ])

    for p in patients:
        writer.writerow([
            p.id, p.name, p.age, p.gender, p.contact, p.address,
            p.chief_complaint, p.pain_level, p.pain_description, 
            p.additional_symptoms, p.medical_history,
            p.emergency_name, p.emergency_relation, p.emergency_gender, 
            p.emergency_contact, p.emergency_address,
            p.photo_filename  # ✅ Include photo column
        ])

    output = make_response(si.getvalue())
    output.headers["Content-Disposition"] = "attachment; filename=patients.csv"
    output.headers["Content-type"] = "text/csv"
    return output

# =================== Main Entry Point ====================
if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)