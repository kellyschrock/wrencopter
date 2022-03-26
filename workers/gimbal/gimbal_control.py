# Import libraries
from tkinter.ttk import Separator
from urllib.parse import ParseResultBytes
import RPi.GPIO as GPIO
import sys
import time
import os

# Basic servo movement, taken from https://www.explainingcomputers.com/sample_code/Servo_Test_CC_Go_to_Angle.py
# Hook servos up as explained here: https://www.youtube.com/watch?v=xHDT4CwjUQE&ab_channel=ExplainingComputers

# Set GPIO numbering mode
GPIO.setmode(GPIO.BOARD)

# Set pins 11 & 12 as outputs, and define as PWM servo1 & servo2
GPIO.setup(11,GPIO.OUT)
rollServo = GPIO.PWM(11,50) # pin 11 for servo1, 50Hz
GPIO.setup(13,GPIO.OUT)
pitchServo = GPIO.PWM(13,50) # pin 13 for servo2

# Start PWM running on both servos, value of 0 (pulse off)
rollServo.start(0)
pitchServo.start(0)

currRoll = -1.0
currPitch = -1.0

# Limits/trims
rollLimitLow = -1.0
rollLimitHigh = -1.0
rollTrim = 0.0
pitchLimitLow = -1.0
pitchLimitHigh = -1.0
pitchTrim = 0.0

smoothOn = False
moveFraction = 40

def findIn(str, thing, start=0):
    return str.find(thing, start)

def findRollIn(str):
    index = findIn(str, "roll=")

    if index >= 0:
        end = findIn(str, " ", index+5)
        if end < 0:
            end = len(str)

        result = float(str[index + 5:end])
        return result

    return -1.0

def findPitchIn(str):
    index = findIn(str, "pitch=")

    if index >= 0:
        end = findIn(str, " ", index+5)
        if end < 0:
            end = len(str)

        return float(str[index + 6:end])

    return -1.0

def limitLow(value, limit):
    if limit > 1.0:
        if value < limit:
            value = limit
    return value

def limitHigh(value, limit):
    if limit > 1.0:
        if value > limit:
            value = limit
    return value

def limitRoll(roll):
    roll = limitHigh(roll, rollLimitHigh)
    roll = limitLow(roll, rollLimitLow)
    return roll

def limitPitch(pitch):
    pitch = limitHigh(pitch, pitchLimitHigh)
    pitch = limitLow(pitch, pitchLimitLow)
    return pitch

def findInList(list, value):
    try:
        return list.index(value)
    except:
        return -1

def doSetRoll(roll):
    pwm = (2 + roll / 18)
    rollServo.ChangeDutyCycle(pwm)
    time.sleep(1/10)
    rollServo.ChangeDutyCycle(0)

# This approach sucks fairly hard. It it's exactly smooth.
# But it's the only way to make a servo not go full-throttle to its target.
def smoothRollTo(roll):
    global currRoll
    global moveFraction

    if currRoll == -1:
        currRoll = roll

    diff = abs(roll - currRoll)
    step = min(1, diff / moveFraction)

    if step > 0:
        # Populate an array with values between currRoll and targetRoll
        array = []
        if(currRoll > roll):
            x = currRoll
            while x > roll:
                array.append(x)
                x -= step
        else:
            x = currRoll
            while x < roll:
                array.append(x)
                x += step

        sleepTime = (1 / moveFraction) / 10
        print("step=%f size=%d sleepTime=%f roll=%f currRoll=%f" % (step, len(array), sleepTime, roll, currRoll))

        for x in array:
            print("set roll to %f" % (x))
            doSetRoll(x)
        doSetRoll(roll)
        currRoll = roll
    else:
        doSetRoll(roll)
        currRoll = roll

def smoothPitchTo(pitch):
    global currPitch
    global moveFraction

    if currPitch == -1:
        currPitch = pitch

    diff = abs(pitch - currPitch)
    step = min(1, diff / moveFraction)
    print("diff=%f step=%f pitch=%f currPitch=%f" % (diff, step, pitch, currPitch))

    if step > 0:
        # Populate an array with values between currPitch and targetPitch
        array = []
        if(currPitch > pitch):
            x = currPitch
            while x > pitch:
                array.append(x)
                x -= step
        else:
            x = currPitch
            while x < pitch:
                array.append(x)
                x += step

        for x in array:
            doSetPitch(x)
        doSetPitch(pitch)
    else:
        doSetPitch(pitch)
        currPitch = pitch

def doSetPitch(pitch):
    pwm = (2 + pitch / 18)
    pitchServo.ChangeDutyCycle(pwm)

def handleCommand(line):
    global rollTrim
    global pitchTrim
    global currRoll
    global currPitch
    global pitchLimitLow
    global pitchLimitHigh
    global pitchTrim
    global smoothOn

    line = line.rstrip()

    if line == "quit":
        return False
    elif line.startswith("set "):
        str = line[4:]
        roll = findRollIn(str.rstrip())
        pitch = findPitchIn(str.rstrip())

        out = ""

        if roll != -1.0:
            roll = limitRoll(roll) + rollTrim
            if smoothOn:
                smoothRollTo(roll)
            else:
                doSetRoll(roll)
            currRoll = roll
            out += ("roll=%f" % (currRoll))

        if pitch != -1.0:
            pitch = limitPitch(pitch) + pitchTrim

            if smoothOn:
                smoothPitchTo(pitch)
            else:
                doSetPitch(pitch)

            currPitch = pitch
            out += (" pitch=%f" % (currPitch))

        if pitch != -1.0 or roll != -1.0:
            print(out.lstrip())

        time.sleep(0.1)
        rollServo.ChangeDutyCycle(0)
        pitchServo.ChangeDutyCycle(0)
    elif line.startswith("limit "):
        # limit roll 45,135
        # limit pitch 45,135
        str = line[6:]

        list = str.split()
        rollIndex = findInList(list, "roll")
        pitchIndex = findInList(list, "pitch")

        if rollIndex > -1:
            if list[rollIndex + 1] == "clear":
                rollLimitHigh = -1.0
                rollLimitLow = -1.0
                print("roll limit cleared")
            else:
                l = list[rollIndex + 1].split(",")
                rollLimitLow = float(l[0])
                rollLimitHigh = float(l[1])
                print("roll limit set to %f,%f" % (rollLimitLow, rollLimitHigh))

        if pitchIndex > -1:
            if list[pitchIndex + 1] == "clear":
                pitchLimitHigh = -1.0
                pitchLimitLow = -1.0
                print("pitch limit cleared")
            else:
                l = list[pitchIndex + 1].split(",")
                pitchLimitLow = float(l[0])
                pitchLimitHigh = float(l[1])
                print("pitch limit set to %f,%f" % (pitchLimitLow, pitchLimitHigh))

    elif line.startswith("trim "):
        # trim roll -9
        # trim pitch 5
        str = line[5:]

        list = str.split()
        rollIndex = findInList(list, "roll")
        pitchIndex = findInList(list, "pitch")

        if rollIndex > -1:
            if list[rollIndex + 1] == "clear":
                rollTrim = 0.0
                print("roll trim cleared")
            else:
                rollTrim = float(list[1])
                print("roll trim set to %f" % (rollTrim))

        if pitchIndex > -1:
            if list[pitchIndex + 1] == "clear":
                pitchTrim = 0.0
                print("pitch trim cleared")
            else:
                pitchTrim = float(list[1])
                print("pitch trim set to %f" % (pitchTrim))


    elif line.startswith("get "):
        str = line[4:]
        out = ""
        rollIndex = findIn(str, "roll")
        pitchIndex = findIn(str, "pitch")

        print("rollIndex=%d pitchIndex=%d" % (rollIndex, pitchIndex))

        if rollIndex >= 0:
            out += ("roll=%f " % (currRoll))

        if pitchIndex >= 0:
            out += ("pitch=%f" % (currPitch))

        if rollIndex >= 0 or pitchIndex >= 0:
            print(out)
        else:
            print("roll=%f pitch=%f" % (currRoll, currPitch))

    elif line.startswith("smooth "):
        str = line[7:]
        smoothOn = (str.rstrip() == "on")
        print("smoothOn=%s" % (smoothOn))

    else:
        print("No idea what '%s' means" % (line))

    return True

# Read the config file if available
if os.path.exists("./config.txt"):
    print("Found config")
    configFile = open("./config.txt", "r")
    
    for line in configFile.readlines():
        if(len(line.rstrip()) > 0):
            handleCommand(line.rstrip())

# Wait on stdin for commands
try:
    while True:
        try:
            line = sys.stdin.readline()
        except KeyboardInterrupt:
            break

        if not line:
            break

        if not handleCommand(line):
            break

        sys.stdout.flush()

finally:
    print("cleanup")
    rollServo.stop()
    pitchServo.stop()
    GPIO.cleanup()
    sys.stdout.flush()

