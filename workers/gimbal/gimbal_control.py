# Import libraries
import RPi.GPIO as GPIO
import sys
import time

# Basic servo movement, taken from https://www.explainingcomputers.com/sample_code/Servo_Test_CC_Go_to_Angle.py
# Hook servos up as explained here: https://www.youtube.com/watch?v=xHDT4CwjUQE&ab_channel=ExplainingComputers

# Set GPIO numbering mode
GPIO.setmode(GPIO.BOARD)

# Set pins 11 & 12 as outputs, and define as PWM servo1 & servo2
GPIO.setup(11,GPIO.OUT)
rollServo = GPIO.PWM(11,50) # pin 11 for servo1
GPIO.setup(12,GPIO.OUT)
pitchServo = GPIO.PWM(12,50) # pin 12 for servo2

# Start PWM running on both servos, value of 0 (pulse off)
rollServo.start(0)
pitchServo.start(0)

currRoll = -1.0
currPitch = -1.0

def findIn(str, thing, start=0):
    try:
        return str.index(thing, start)
    except:
        return -1

def findRollIn(str):
    index = findIn(str, "roll=")

    if index > 0:
        end = findIn(str, " ", index+5)
        if end < 0:
            end = len(str)

        return float(str[index + 5, end])
        
    return -1.0

def findPitchIn(str):
    index = findIn(str, "pitch=")

    if index > 0:
        end = findIn(str, " ", index+5)
        if end < 0:
            end = len(str)

        return float(str[index + 6, end])
        
    return -1.0

# Wait on stdin for commands
while True:
    try:
        line = sys.stdin.readline()
    except KeyboardInterrupt:
       break

    if not line:
        break
    
    if line == "quit": 
        rollServo.stop()
        pitchServo.stop()
        GPIO.cleanup()
        break
    elif line.startswith("set "):
        str = line[4:]
        roll = findRollIn(str)
        pitch = findPitchIn(str)

        if roll != -1.0:
            rollServo.changeDutyCycle(2 + roll / 18)

        if pitch != -1.0:
            pitchServo.changeDutyCycle(2 + pitch / 18)

        time.sleep(0.25)
        rollServo.changeDutyCycle(0)
        pitchServo.changeDutyCycle(0)

    sys.stdout.flush()

sys.stdout.flush()
