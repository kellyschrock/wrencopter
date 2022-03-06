import sys
import os
import socket
import time
import picamera
from threading import Thread
from shutter import TakePicture
from video import VideoRecorder

_camServerRun = True

class NetConnection:
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

video_recorder = VideoRecorder()
take_picture = TakePicture()

def handleInput(str):
	if str == "picture":
		take_picture.trigger()
	elif str == "quit":
		os.kill(os.getpid(), 9)
	elif str.startswith("record:"):
		action = str[7:]
		if action == "start":
			video_recorder.start()
		elif action == "stop":
			video_recorder.stop()

def cameraServer(port):
	camera = picamera.PiCamera()
	camera.resolution = (640, 360)
	camera.vflip = True
	camera.hflip = True
	camera.framerate = 30
	take_picture.camera = camera

	# Loop and wait for connections.
	global _camServerRun
	while _camServerRun:
		server_socket = socket.socket()
		server_socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
		server_socket.bind(('0.0.0.0', 5400))
		server_socket.listen(0)
		print("Wait for a connection")

		connection = NetConnection(server_socket.accept()[0].makefile('wb'))
		print("Got a connection")

		camsink = CameraSink()
		camsink.add(connection)
		camsink.add(video_recorder)
		camsink.add(take_picture)

		try:
			camera.start_recording(camsink, bitrate=256000, format='h264', level='4.1', profile='main', inline_headers=True)

			while _camServerRun:
				camera.wait_recording(1)

		except Exception as err:
			print("Running camera: Got {0}".format(err))
			try:
				camera.stop_recording()
			except Exception as err:
				print("Stopping camera caused {0}".format(err))

		finally:
			try:
				camsink.close()
			except Exception as err:
				print("Exception closing camsink: {0}".format(err))

			try:
				server_socket.close()
			except:
				print("Exception closing server_socket")

# Main
_camServerRun = True
camThread = Thread(target = cameraServer, args = (5400,))
camThread.start()

while True:
	try:
		line = sys.stdin.readline()
		if len(line) > 0:
			handleInput(line.rstrip())

	except KeyboardInterrupt:
		_camServerRun = False
		break

print("Done")
os.kill(os.getpid(), 9)


