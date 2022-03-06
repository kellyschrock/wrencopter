import socket
import time
import picamera

camera = picamera.PiCamera()
camera.resolution = (640, 360)
camera.vflip = True
camera.hflip = True
camera.framerate = 30
# camera.brightness = 60
# camera.contrast = 60
# camera.image_effect = "oilpaint"

server_socket = socket.socket()
server_socket.bind(('0.0.0.0', 5400))
server_socket.listen(0)

# Accept a single connection and make a file-like object out of it
connection = server_socket.accept()[0].makefile('wb')
try:
    camera.start_recording(connection, format='h264')
    camera.wait_recording(60)
    camera.stop_recording()
finally:
    connection.close()
    server_socket.close()

