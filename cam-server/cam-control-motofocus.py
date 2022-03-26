import sys
import os
import socket
import time
import picamera
from threading import Thread
from queue import Queue
from ctypes import *
import cv2 #sudo apt-get install python-opencv
import numpy as py

from shutter import TakePicture
from video import VideoRecorder

commandFifo = "/tmp/cam_control.fifo"
configFifo = "/tmp/cam_config.fifo"
eventFifoName = "/tmp/cam_events.fifo"

arducam_vcm =CDLL('./lib/libarducam_vcm.so')

eventFifo = None
eventQueue = None

_camServerRun = True
_cmdFifoRun = True
_configFifoRun = True

def focusing(val):
    arducam_vcm.vcm_write(val)

def sobel(img):
	img_gray = cv2.cvtColor(img,cv2.COLOR_RGB2GRAY)
	img_sobel = cv2.Sobel(img_gray,cv2.CV_16U,1,1)
	return cv2.mean(img_sobel)[0]

def laplacian(img):
	img_gray = cv2.cvtColor(img,cv2.COLOR_RGB2GRAY)
	img_sobel = cv2.Laplacian(img_gray,cv2.CV_16U)
	return cv2.mean(img_sobel)[0]

def calculation(camera):
	rawCapture = PiRGBArray(camera) 
	camera.capture(rawCapture,format="bgr", use_video_port=True)
	image = rawCapture.array
	rawCapture.truncate(0)
	return laplacian(image)

def autofocus(camera):
	max_index = 10
	max_value = 0.0
	last_value = 0.0
	dec_count = 0
	focal_distance = 10

	while True:
		#Adjust focus
		focusing(focal_distance)
		#Take image and calculate image clarity
		val = calculation(camera)
		#Find the maximum image clarity
		if val > max_value:
			max_index = focal_distance
			max_value = val
            
		#If the image clarity starts to decrease
		if val < last_value:
			dec_count += 1
		else:
			dec_count = 0
		#Image clarity is reduced by six consecutive frames
		if dec_count > 6:
			break
		last_value = val
        
		#Increase the focal distance
		focal_distance += 15
		if focal_distance > 100:
			break

	focusing(max_index)


def say(str):
	print >> sys.stderr, str

class StreamConnection:
	def __init__(self, output):
		self.output = output

	def write(self, s):
		self.output.write(s)

	def flush(self):
		self.output.flush()

	def close(self):
		try:
			self.output.close()
		except:
			pass

# Main camera sink. Delegates everything to handlers loaded via .add()
class CameraSink:
	def __init__(self):
		self.handlers = []

	def write(self, s):
		for item in self.handlers:
			item.write(s)

	def flush(self):
		for item in self.handlers:
			item.flush()

	def close(self):
		for item in self.handlers:
			item.close()

	def add(self, handler):
		self.handlers.append(handler)

def eventCallback(msg):
	if eventQueue is not None:
		eventQueue.put("{0}\n".format(msg))

video_recorder = VideoRecorder(eventCallback)
take_picture = TakePicture(eventCallback)

def handleConfigInput(str):
	global take_picture

	camera = take_picture.camera

	# say(str)

	try:
		if camera is not None:
			if str.startswith("contrast"):
				camera.contrast = int(str[9:])
			elif str.startswith("saturation"):
				camera.saturation = int(str[11:])
			elif str.startswith("brightness"):
				camera.brightness = int(str[11:])
			elif str.startswith("sharpness"):
				camera.sharpness = int(str[10:])
			elif str.startswith("image_effect"):
				camera.image_effect = str[13:]
			elif str.startswith("exposure_mode"):
				camera.exposure_mode = str[14:]
			elif str.startswith("meter_mode"):
				camera.meter_mode = str[11:]
			elif str.startswith("awb"):
				camera.awb_mode = str[4:]
			elif str.startswith("iso"):
				camera.iso = int(str[4:].strip())
			elif str.startswith("focus"):
				focus_val = int(str[6:].strip())
				arducam_vcm.vcm_write(focus_val)
			elif str.startswith("drc"): # off, low, medium, high
				camera.drc_strength = str[4:]
			elif str.startswith("hflip"):
				camera.hflip = (str[6:] == "true")
			elif str.startswith("vflip"):
				camera.vflip = (str[6:] == "true")
			elif str.startswith("zoom"):
				zoom_value = float(str[5:]) / 10.0
				if zoom_value < 1.0:
					camera.zoom = (zoom_value / 2.0, zoom_value / 2.0, 1.0 - zoom_value, 1.0 - zoom_value)
	except Exception as e:
		say(e)


def handleCommandInput(str):
	global _camServerRun
	global take_picture

	if take_picture is None:
		return

	if str == "picture":
		take_picture.trigger()
	elif str == "quit":
		_camServerRun = False
		os.kill(os.getpid(), 9)
	elif str.startswith("record:"):
		action = str[7:]
		if action == "start":
			video_recorder.start()
		elif action == "stop":
			video_recorder.stop()
	elif str.startswith("exif:"):
		kv = str[5:]
		vi = kv.find("=")
		if vi >= 0:
			k = kv[0:vi]
			# say("k=" + k + " v=" + kv[vi+1:])
			take_picture.exif_tags[k] = kv[vi+1:]
	elif str.startswith("location="):
		kv = str[len("location")+1:]
		exif = take_picture.setLocation(kv)
		# say("exif=%s" % exif)


def cameraServer():
	camera = picamera.PiCamera()
	camera.resolution = (1280, 720)
	camera.vflip = True
	camera.hflip = True
	camera.brightness = 50
	camera.framerate = 30
	camera.meter_mode = 'backlit' # This seems to be better than 'auto'
	# camera.sharpness = 3
	# camera.saturation = 10
	# camera.image_effect = 'negative'
	# camera.exposure_mode = 'night'
	# camera.contrast = 1
	camera.exposure_mode = 'antishake'
	# camera.drc_strength = 'high'
	# camera.sensor_mode = 1
	# camera.zoom = (0.0, 0.0, 1.0, 1.0)
	# camera.video_denoise = False
	camera.video_stabilization = True
	# camera.crop = (160, 160, 640, 400)

	take_picture.camera = camera

	arducam_vcm.vcm_init()

	# Loop and wait for connections.
	global _camServerRun
	while _camServerRun:
		connection = StreamConnection(sys.stdout)

		camsink = CameraSink()
		camsink.add(connection)
		camsink.add(video_recorder)
		camsink.add(take_picture)

		try:
			# autofocus(camera)
			camera.start_recording(camsink, format='h264', bitrate=10000000)
			# camera.start_recording(camsink, format='rgb')

			while _camServerRun:
				camera.wait_recording(1)

		except KeyboardInterrupt:
			say("KeyboardInterrupt")
			os.kill(os.getpid(), 9)

		except ValueError as verr:
			say("ValueError")
			os.kill(os.getpid(), 9)

		except Exception as err:
			say(err)
			try:
				camera.stop_recording()
			except Exception as err:
				os.kill(os.getpid(), 9)

		finally:
			say("Finally: Close camera")
			try:
				camsink.close()
			except Exception as err:
				os.kill(os.getpid(), 9)

	say("camServer() done")

def listenCommandFifo():
	global _cmdFifoRun

	if os.path.exists(commandFifo):
		print("Using existing fifo")
	else:
		os.mkfifo(commandFifo)

	while _cmdFifoRun:
		try:
			fifo = open(commandFifo, "r")
			line = fifo.readline()
			say(line)
			if len(line) > 0:
				handleCommandInput(line.rstrip())
			fifo.close()
		except KeyboardInterrupt:
			fifo.close()
			os.unlink(commandFifo)
			os.kill(os.getpid(), 9)

def listenConfigFifo():
	global _configFifoRun

	if(os.path.exists(configFifo)):
		say("Using existing config fifo")
	else:
		say("Making config fifo")
		os.mkfifo(configFifo)

	while _configFifoRun:
		try:
			fifo = open(configFifo, "r")
			line = fifo.readline()
			say(line)
			if(len(line) > 0):
				handleConfigInput(line.rstrip())
			fifo.close()				

		except KeyboardInterrupt:
			fifo.close()
			os.unlink(configFifo)

def startEventFifo(queue):
	global eventFifo
	global eventFifoName

	if os.path.exists(eventFifoName):
		print("Use existing event FIFO")
	else:
		print("Make event FIFO")
		os.mkfifo(eventFifoName)

	while True:
		data = eventQueue.get()
		say("Got {0} for event FIFO".format(data))
		eventFifo = open(eventFifoName, "w")
		eventFifo.write(data)
		eventFifo.close()


def doExit():
	os.kill(os.getpid(), 9)

# main

say("Start command thread")
fifoCommandThread = Thread(target = listenCommandFifo)
fifoCommandThread.start()

say("Start config thread")
fifoConfigThread = Thread(target = listenConfigFifo)
fifoConfigThread.start()

eventQueue = Queue()
fifoEventThread = Thread(target = startEventFifo, args =(eventQueue, ))
fifoEventThread.start()

try:
	cameraServer()
except:
	say("Outer exception")
	os.kill(os.getpid(), 9)
