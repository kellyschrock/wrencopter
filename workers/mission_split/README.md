# Mission Split

This worker is basically a demo of IVC, which allows vehicles to communicate with each other.

In this scenario, `mission_split` is installed on SolexCC running on two or more vehicles connected to the same network. As each vehicle is powered on, it 
starts broadcasting its presence on the network. Other vehicles see this broadcast and connect to it. After connecting, they interrogate each other to see 
if there's any point in them collaborating on anything. When `mission_split` is installed on more than one vehicle, they agree that they could collaborate on splitting a mission, provided the mission they're loaded with is the _same_ mission. 

Suppose you have 3 copters sitting on the ground running with IVC enabled and `mission_split` installed on each.

Make a mission with a takeoff at the beginning, and an RTL command at the end. Load it onto each vehicle. (Solex/Desktop makes this easy, FWIW.)

Launch the first one and hover it. Subsequent vehicles, having subscribed to each others' events, will notice the first vehicle in the air.

Launch the second vehicle and hover it. At this point, it will tell the first vehicle to only run the first half of the mission.

Launch the third and hover it. It will tell the other two to run 1/3 of the mission each.

Switch the first one into Auto mode. It will start at the beginning of the mission, and fly until it reaches its stop point. Then it will return to its launch point.

Once the first copter is underway, switch the second one to Auto. It will fly to a point just after the last point handled by the first copter, and start running it.

The third copter will go to the last 3rd of the mission when it's switched to Auto.

Obviously there are complications associated with this. You do not want to hover copters 2 and 3 in the path of copter 1 when it's switched to Auto, for example. 


